import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config';
import { postgresConnection } from '../db/connection';
import { assertDatabaseVersion } from '../db/migrations';
import { IdentityLifecycle } from './lifecycle';

export async function runIdentityCommand(command: string) {
  if (!['reconcile', 'worker'].includes(command)) throw new Error('Choose identity reconcile or worker.');
  const config = loadConfig();
  if (!config.databaseUrl || !config.identity?.lifecycle) throw new Error('Identity maintenance requires explicit PostgreSQL and managed lifecycle configuration.');
  const db = postgresConnection(config.databaseUrl), shutdown = new AbortController();
  let lifecycle: IdentityLifecycle | undefined;
  const stop = () => shutdown.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    await assertDatabaseVersion(db);
    lifecycle = await IdentityLifecycle.open(db, config.identity, shutdown.signal, undefined, true);
    let nextSweep = 0, completed = 0;
    while (!shutdown.signal.aborted) {
      if (Date.now() >= nextSweep) { await lifecycle.enqueueSweep(); nextSweep = Date.now() + 60000; }
      const claim = await lifecycle.jobs.claim('identity.reconcile');
      if (claim) {
        try { await lifecycle.runClaim(claim, shutdown.signal); completed++; }
        catch (error) { await lifecycle.jobs.fail(claim); if (shutdown.signal.aborted) return; throw error; }
      } else if (command === 'reconcile') {
        const row = await db.prepare("SELECT count(*)::integer AS pending FROM durable_operations WHERE kind='identity.reconcile' AND completed_at IS NULL").get();
        if (row?.pending !== 0) throw new Error('The identity reconciliation pass has deferred, active or failed operations. Inspect queue diagnostics; reconciliation is not complete.');
        console.log(JSON.stringify({ event: 'identity.reconciliation.completed', completed }));
        return;
      } else {
        try { await delay(1000, undefined, { signal: shutdown.signal }); }
        catch (error) { if (!shutdown.signal.aborted) throw error; }
      }
    }
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    try { await lifecycle?.close(); } finally { await db.close(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIdentityCommand(process.argv[2] ?? '').catch(() => {
    console.error('Identity maintenance failed. Inspect private provider/queue availability and replay diagnostics; no success was reported.');
    process.exitCode = 1;
  });
}
