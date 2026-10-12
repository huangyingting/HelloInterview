import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { loadConfig } from '../config';
import { postgresConnection } from '../db/connection';
import { assertDatabaseVersion } from '../db/migrations';
import { BillingNotifications } from './index';

export async function runBillingCommand(command: string, client?: Stripe) {
  if (!['reconcile', 'worker'].includes(command)) throw new Error('Choose billing reconcile or worker.');
  const config = loadConfig();
  if (!config.databaseUrl || !config.billing) throw new Error('Billing maintenance requires explicit sandbox billing, managed identity and PostgreSQL configuration.');
  const db = postgresConnection(config.databaseUrl), shutdown = new AbortController();
  let billing: BillingNotifications | undefined;
  const stop = () => shutdown.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    await assertDatabaseVersion(db);
    billing = await BillingNotifications.open(db, config.billing, shutdown.signal, true, client);
    let completed = 0;
    while (!shutdown.signal.aborted) {
      const claim = await billing.jobs.claim('billing.reconcile');
      if (claim) {
        try { await billing.runClaim(claim, shutdown.signal); completed++; }
        catch (error) { await billing.jobs.fail(claim); if (shutdown.signal.aborted) return; throw error; }
      } else if (command === 'reconcile') {
        const row = await db.prepare("SELECT count(*)::integer AS pending FROM durable_operations WHERE kind='billing.reconcile' AND completed_at IS NULL").get();
        if (row?.pending !== 0) throw new Error('Billing notification reconciliation has deferred, active or failed operations. Inspect queue diagnostics; the pass is incomplete.');
        console.log(JSON.stringify({ event: 'billing.notifications.reconciled', completed, authority: 'notification-evidence-only' }));
        return;
      } else {
        try { await delay(1000, undefined, { signal: shutdown.signal }); }
        catch (error) { if (!shutdown.signal.aborted) throw error; }
      }
    }
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    try { await billing?.close(); } finally { await db.close(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBillingCommand(process.argv[2] ?? '').catch(() => {
    console.error('Billing notification maintenance failed. Inspect private provider/queue availability and replay diagnostics; no payment, entitlement or success was reported.');
    process.exitCode = 1;
  });
}
