import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { loadConfig } from '../config';
import { prismaConnection } from '../db/prisma';
import { assertDatabaseVersion } from '../db/migrations';
import { BillingNotifications } from './index';
import { checkoutJobKinds } from './checkout';
import { TerminalJobFailure } from '../jobs';

export async function runBillingCommand(command: string, client?: Stripe) {
  if (!['reconcile', 'worker'].includes(command)) throw new Error('Choose billing reconcile or worker.');
  const config = loadConfig();
  if (!config.databaseUrl || !config.billing) throw new Error('Billing maintenance requires explicit sandbox billing, managed identity and PostgreSQL configuration.');
  const db = prismaConnection(), shutdown = new AbortController();
  let billing: BillingNotifications | undefined;
  const stop = () => shutdown.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    await assertDatabaseVersion(db);
    billing = await BillingNotifications.open(db, config.billing, shutdown.signal, true, client, config.publicOrigin ?? undefined);
    let completed = 0, owned = false, ledger = false, nextSweep = 0;
    while (!shutdown.signal.aborted) {
      if (Date.now() >= nextSweep && (command === 'worker' || nextSweep === 0)) {
        await billing.checkout?.enqueueSweep(); await billing.ledger.enqueueSweep(); nextSweep = Date.now() + 60000;
      }
      let claim;
      for (const kind of [...checkoutJobKinds, 'billing.reconcile', 'billing.customer.snapshot'] as const) {
        claim = await billing.jobs.claim(kind);
        if (claim) break;
      }
      if (claim) {
        try { await billing.runClaim(claim, shutdown.signal); completed++; owned ||= claim.name !== 'billing-reconcile'; ledger ||= claim.name === 'billing-customer-snapshot'; }
        catch (error) {
          await billing.jobs.fail(claim, error instanceof TerminalJobFailure ? 'reconciliation-required' : 'handler-failed');
          if (shutdown.signal.aborted) return;
          throw error;
        }
      } else if (command === 'reconcile') {
        const row = await db.prepare("SELECT count(*)::integer AS pending FROM durable_operations WHERE kind LIKE 'billing.%' AND completed_at IS NULL").get();
        if (row?.pending !== 0) throw new Error('Sandbox billing reconciliation has deferred, active or failed operations. Inspect queue diagnostics; the pass is incomplete.');
        const reviewRequired = await billing.ledger.reviewRequiredCustomers();
        if (reviewRequired) console.warn(JSON.stringify({ event: 'billing.ledger.review-required', customers: reviewRequired, authority: config.billing.accessPolicy ?? 'sandbox-ledger-observation-only' }));
        console.log(JSON.stringify({ event: owned ? 'billing.sandbox.reconciled' : 'billing.notifications.reconciled', completed,
          authority: ledger ? config.billing.accessPolicy ?? 'sandbox-ledger-observation-only' : owned ? 'sandbox-correlation-only' : 'notification-evidence-only' }));
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
    console.error('Sandbox billing maintenance failed. Inspect private provider/queue availability and replay diagnostics; unknown external outcomes are not payment or entitlement proof.');
    process.exitCode = 1;
  });
}
