import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { loadAuthSettings } from '../auth/config';
import { assertDatabaseVersion } from '../db/migrations';
import { prismaConnection } from '../db/prisma';
import { loadAccountMailSender } from './mail-config';
import { pruneAccountAdmissionRecords } from './retention';
import { processAccountMailBatch } from './worker';

export async function runAccountMailCommand(command: string) {
  if (!['process', 'worker'].includes(command)) throw new Error('Choose account-mail process or worker.');
  if (!loadAuthSettings() || !loadAccountMailSender()) throw new Error('Configure authentication and account email delivery before starting its worker.');
  const db = prismaConnection();
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    await assertDatabaseVersion(db);
    let nextMaintenance = 0;
    do {
      if (Date.now() >= nextMaintenance) {
        await pruneAccountAdmissionRecords();
        nextMaintenance = Date.now() + 60000;
      }
      const counts = await processAccountMailBatch(shutdown.signal);
      if (command === 'process' || counts.sent + counts.failed + counts.unconfirmed > 0) {
        console.log(JSON.stringify({ event: 'account-mail.batch-processed', ...counts }));
      }
      if (command === 'process') {
        if (counts.failed || counts.unconfirmed) throw new Error('Email delivery needs provider reconciliation.');
        return;
      }
      try { await delay(5000, undefined, { signal: shutdown.signal }); }
      catch (error) { if (!shutdown.signal.aborted) throw error; }
    } while (!shutdown.signal.aborted);
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAccountMailCommand(process.argv[2] ?? '').catch(() => {
    console.error('Account email processing failed. Inspect private outbox status and provider receipts; no recipient, token, or provider credentials are logged.');
    process.exitCode = 1;
  });
}
