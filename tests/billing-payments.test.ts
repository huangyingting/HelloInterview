import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { openBillingFixture, sandboxSettings } from './fixtures/billing';
import { stripeApiVersion } from '../server/billing/schema';
import { LostJobClaim, TerminalJobFailure } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';

async function fixture(t: TestContext) {
  const f = await openBillingFixture(t), login = await f.login(), intent = await f.reserve(login.browser);
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  const facts = await f.settleCheckout();
  assert.equal((await login.browser.request(`/api/billing/checkouts/${intent.id}/refresh`, {})).status, 200);
  await f.complete('billing.checkout.refresh');
  return { ...f, ownerBrowser: login.browser, owner: login.owner, facts };
}
async function drain(f: Pick<Awaited<ReturnType<typeof fixture>>, 'worker'>) {
  for (let count = 0; count < 4; count++) {
    const claim = await f.worker.jobs.claim('billing.customer.snapshot');
    if (!claim) return;
    await f.worker.runClaim(claim);
  }
  assert.fail('Customer generations must converge.');
}
function refund(f: Awaited<ReturnType<typeof fixture>>, id: string, amount: number, status = 'succeeded') {
  const value = { id, object: 'refund', charge: f.facts.charge.id, payment_intent: f.facts.intent.id,
    customer: f.facts.charge.customer, currency: 'usd', amount, status, metadata: {} };
  f.refunds.set(id, value); return value;
}
function dispute(f: Awaited<ReturnType<typeof fixture>>, status = 'needs_response') {
  const value = { id: 'dp_Synthetic', object: 'dispute', charge: f.facts.charge.id, payment_intent: f.facts.intent.id,
    livemode: false, currency: 'usd', amount: 1900, status, evidence: { customer_email_address: 'private-dispute-contact@example.invalid' } };
  f.disputes.set(value.id, value); f.facts.charge.disputed = true; return value;
}
function credit(f: Awaited<ReturnType<typeof fixture>>) {
  const value = { id: 'cn_Synthetic', object: 'credit_note', customer: f.facts.charge.customer, invoice: f.facts.invoice.id,
    currency: 'usd', amount: 500, livemode: false, status: 'issued', pdf: 'https://private.fixture/credit' };
  f.credits.set(value.id, value); return value;
}
async function funding(f: Awaited<ReturnType<typeof fixture>>) { return (await f.view(f.ownerBrowser)).ledger?.invoices[0].funding; }

test('canonical card allocation, PaymentIntent, captured charge and complete reversal lists establish sandbox funding, not service or access authority', async t => {
  const f = await fixture(t); await drain(f);
  assert.deepEqual(await funding(f), { state: 'settled', captured: 1900, refunded: 0, creditAdjusted: false });
  const row = await f.db.prepare('SELECT payload FROM stripe_owned_invoice_ledger').get(); assert.ok(row);
  const fact = JSON.parse(z.string().parse(row.payload));
  assert.equal(fact.funding.intents[0].received, 1900);
  assert.equal(fact.funding.intents[0].allocations[0].invoiceId, f.facts.invoice.id);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_invoice_charge_links').get())?.count, 1);
  for (const secret of ['private-payment-intent-secret', 'private-card-contact', 'https://private.fixture/receipt']) assert.ok(!String(row.payload).includes(secret));
  for (const secret of ['ch_Synthetic', 'pi_Synthetic', 'inpay_Synthetic']) assert.ok(!JSON.stringify(await f.view(f.ownerBrowser)).includes(secret));
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.ok(f.requests.filter(value => value.path.includes('refund') || value.path.includes('dispute') || value.path.includes('payment_intent')).every(value => value.method === 'GET'));
});

test('pending refund counters are not successful reversals; old-invoice refund notifications target their card allocation and converge to partial/full refund facts', async t => {
  const f = await fixture(t);
  f.facts.invoice.created -= 120 * 86400; await drain(f);
  Object.assign(f.facts.sub, { latest_invoice: null });
  const first = refund(f, 're_Pending', 500, 'pending'); f.facts.charge.amount_refunded = 500;
  await f.notify('refund', first, 'refund.created'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await funding(f))?.state, 'review-required'); assert.equal((await funding(f))?.refunded, 0);
  assert.ok((await f.view(f.ownerBrowser)).ledger?.reviewReasons.includes('refund-pending'));
  first.status = 'succeeded';
  await f.notify('refund', first, 'refund.updated'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await funding(f))?.state, 'partially-refunded'); assert.equal((await funding(f))?.refunded, 500);
  const second = refund(f, 're_Remaining', 1400); f.facts.charge.amount_refunded = 1900; f.facts.charge.refunded = true;
  await f.notify('refund', second, 'refund.updated'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await funding(f))?.state, 'refunded'); assert.equal((await funding(f))?.refunded, 1900);
  assert.ok(f.requests.some(request => request.path === `/v1/invoices/${f.facts.invoice.id}`));
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
});

test('failed/canceled refunds stay recorded without reducing settled funds; succeeded reversals cannot disappear or become failed', async t => {
  const f = await fixture(t);
  refund(f, 're_Failed', 500, 'failed'); refund(f, 're_Canceled', 500, 'canceled');
  await drain(f); assert.equal((await funding(f))?.state, 'settled');
  const success = refund(f, 're_Succeeded', 500); f.facts.charge.amount_refunded = 500;
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202); await drain(f);
  success.status = 'failed'; f.facts.charge.amount_refunded = 0;
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await funding(f))?.refunded, 500);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('dispute notification targeting retains closed/won evidence and never restores access or erases an earlier dispute', async t => {
  const f = await fixture(t); f.facts.invoice.created -= 120 * 86400; await drain(f);
  Object.assign(f.facts.sub, { latest_invoice: null });
  const value = dispute(f);
  await f.notify('dispute', value, 'charge.dispute.created'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await funding(f))?.state, 'disputed');
  value.status = 'won';
  await f.notify('dispute', value, 'charge.dispute.closed'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await funding(f))?.state, 'disputed');
  assert.ok((await f.view(f.ownerBrowser)).ledger?.reviewReasons.includes('payment-disputed'));
  f.disputes.clear(); f.facts.charge.disputed = false;
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
});

test('signed canonical credit-note events explicitly target old invoices, retain voided notes and hold unapproved credit policy', async t => {
  const f = await fixture(t); f.facts.invoice.created -= 120 * 86400; await drain(f);
  Object.assign(f.facts.sub, { latest_invoice: null });
  const value = credit(f);
  await f.notify('credit_note', value, 'credit_note.created'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await funding(f))?.state, 'review-required'); assert.equal((await funding(f))?.creditAdjusted, true);
  value.status = 'void';
  await f.notify('credit_note', value, 'credit_note.voided'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await funding(f))?.state, 'settled'); assert.equal((await funding(f))?.creditAdjusted, false);
  const row = await f.db.prepare('SELECT payload FROM stripe_owned_invoice_ledger').get();
  assert.ok(String(row?.payload).includes('cn_Synthetic')); assert.ok(!String(row?.payload).includes('https://private.fixture/credit'));
});

test('foreign/mismatched PI, charge, allocation, refund, dispute and credit data cannot publish financial success or private fields', async t => {
  const f = await fixture(t); await drain(f);
  const r = refund(f, 're_Invalid', 500, 'failed'), d = dispute(f), c = credit(f);
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  for (const [object, field, value] of [
    [f.facts.intent, 'customer', 'cus_Foreign'], [f.facts.intent, 'livemode', true], [f.facts.intent, 'currency', 'eur'],
    [f.facts.charge, 'customer', 'cus_Foreign'], [f.facts.charge, 'livemode', true], [f.facts.charge, 'currency', 'eur'],
    [f.facts.charge, 'payment_intent', 'pi_Foreign'], [f.facts.charge, 'destination', 'acct_Foreign'],
    [f.facts.charge, 'on_behalf_of', 'acct_Foreign'], [f.facts.charge, 'transfer_data', { destination: 'acct_Foreign' }],
    [f.facts.payment, 'currency', 'eur'], [f.facts.payment, 'livemode', true], [f.facts.payment, 'invoice', 'in_Foreign'],
    [r, 'currency', 'eur'], [r, 'payment_intent', 'pi_Foreign'], [r, 'customer', 'cus_Foreign'],
    [d, 'currency', 'eur'], [d, 'livemode', true], [d, 'charge', 'ch_Foreign'], [d, 'payment_intent', 'pi_Foreign'],
    [c, 'customer', 'cus_Foreign'], [c, 'livemode', true], [c, 'currency', 'eur'],
  ] as const) {
    const record: Record<string, unknown> = object, old = record[field]; record[field] = value;
    await assert.rejects(f.worker.runClaim(claim), `Invalid ${String(record.object)}.${field} must not publish.`); record[field] = old;
    assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  }
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_customer_ledger_snapshots').get())?.count, 1);
  await f.worker.runClaim(claim);
});

test('requires-action/uncaptured payment states and multiple allocated invoices remain nonsettled; zero/out-of-band hints never borrow card funds', async t => {
  const f = await fixture(t);
  f.facts.invoice.status = 'open'; f.facts.invoice.amount_paid = 0; f.facts.invoice.amount_remaining = 1900;
  Object.assign(f.facts.invoice.status_transitions, { paid_at: null });
  f.facts.intent.status = 'requires_action'; f.facts.intent.amount_received = 0;
  f.facts.charge.status = 'pending'; f.facts.charge.captured = false; f.facts.charge.amount_captured = 0;
  f.facts.payment.status = 'open'; Object.assign(f.facts.payment, { amount_paid: null });
  await drain(f); assert.equal((await funding(f))?.state, 'unpaid');
  f.facts.invoice.status = 'paid'; f.facts.invoice.amount_paid = 1900; f.facts.invoice.amount_remaining = 0;
  Object.assign(f.facts.invoice.status_transitions, { paid_at: Math.floor(Date.now() / 1000) });
  f.facts.intent.status = 'succeeded'; f.facts.intent.amount_received = 1900;
  f.facts.charge.status = 'succeeded'; f.facts.charge.captured = true; f.facts.charge.amount_captured = 1900;
  f.facts.payment.status = 'paid'; f.facts.payment.amount_paid = 1900;
  f.invoicePayments.set('in_OtherAllocation', [{ ...structuredClone(f.facts.payment), id: 'inpay_OtherAllocation', invoice: 'in_OtherAllocation' }]);
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202); await drain(f);
  assert.equal((await funding(f))?.state, 'review-required');
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
});

test('complete refund pagination and request failures keep old settlement evidence intact rather than publishing a partial reversal', async t => {
  const f = await fixture(t); await drain(f);
  for (let index = 0; index < 150; index++) refund(f, `re_Page${index}`, 1);
  f.facts.charge.amount_refunded = 150;
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202); await drain(f);
  assert.equal((await funding(f))?.refunded, 150);
  f.pagination('/v1/refunds');
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); f.pagination('');
  f.outage('/v1/disputes'); await assert.rejects(f.worker.runClaim(claim));
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal((await funding(f))?.refunded, 150);
});

test('financial movement between charge list/detail or final reread cannot borrow another intent or commit stale funding', async t => {
  const f = await fixture(t); await f.complete('billing.customer.snapshot');
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  for (const movement of ['counter', 'intent', 'method'] as const) {
    let reads = 0;
    f.barrier(async path => {
      if (path !== `/v1/charges/${f.facts.charge.id}` || ++reads !== (movement === 'intent' ? 1 : 2)) return;
      if (movement === 'counter') f.facts.charge.amount_refunded = 1;
      else if (movement === 'intent') f.facts.charge.payment_intent = 'pi_Foreign';
      else f.facts.charge.payment_method_details.type = 'sepa_debit';
    });
    await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure, `${movement} movement must not publish.`);
    assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_invoice_charge_links').get())?.count, 0);
    assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
    f.facts.charge.amount_refunded = 0; f.facts.charge.payment_intent = f.facts.intent.id; f.facts.charge.payment_method_details.type = 'card';
  }
});

test('final intent and complete allocation rereads reject late amount or borrowed-allocation movement; final invoice references reject changed payments', async t => {
  const f = await fixture(t); await drain(f);
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  for (const movement of ['intent', 'allocation', 'invoice-payment'] as const) {
    let reads = 0;
    f.barrier(async path => {
      const target = movement === 'intent' ? `/v1/payment_intents/${f.facts.intent.id}` :
        movement === 'allocation' ? '/v1/invoice_payments' : `/v1/invoices/${f.facts.invoice.id}`;
      const finalRead = movement === 'invoice-payment' ? 1 : 2;
      if (path !== target || ++reads !== finalRead) return;
      if (movement === 'intent') f.facts.intent.amount_received = 0;
      else if (movement === 'allocation') f.invoicePayments.set('in_LateAllocation',
        [{ ...structuredClone(f.facts.payment), id: 'inpay_LateAllocation', invoice: 'in_LateAllocation' }]);
      else f.facts.payment.amount_paid = 0;
    });
    await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure, `${movement} movement must not publish.`);
    assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
    assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_customer_ledger_snapshots').get())?.count, 1);
    assert.equal((await funding(f))?.state, 'settled');
    f.facts.intent.amount_received = 1900; f.facts.payment.amount_paid = 1900;
    f.invoicePayments.delete('in_LateAllocation');
  }
  f.barrier(async () => {}); await f.worker.runClaim(claim);
});

test('voided credits cannot disappear or reissue even when an unsupported payment record has no charge evidence', async t => {
  const f = await fixture(t), value = credit(f);
  Object.assign(f.facts.payment, { payment: { type: 'payment_record', payment_record: 'pr_SyntheticUnattested' } });
  await drain(f); assert.equal((await funding(f))?.creditAdjusted, true);
  value.status = 'void';
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202); await drain(f);
  assert.equal((await funding(f))?.creditAdjusted, false);
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  value.status = 'issued'; await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  f.credits.clear(); await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  value.status = 'void'; value.currency = 'eur'; f.credits.set(value.id, value);
  f.facts.invoice.currency = 'eur'; f.facts.payment.currency = 'eur'; f.facts.line.currency = 'eur';
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal((await funding(f))?.creditAdjusted, false);
});

test('a lease expiring inside actual financial-link SQL rolls payment facts, link, snapshot and completion back', async t => {
  const f = await fixture(t); await f.complete('billing.customer.snapshot');
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  const row = await f.db.prepare("SELECT job_id FROM durable_operations WHERE kind='billing.customer.snapshot' AND completed_at IS NULL").get(); assert.ok(row);
  await boss.update('billing-customer-snapshot', undefined, { id: String(row.job_id), expireInSeconds: 2 });
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE payment_publication_witness;
    CREATE FUNCTION expire_payment_link() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('payment_publication_witness'); PERFORM pg_sleep(2.1); RETURN NEW; END $body$;
    CREATE TRIGGER expire_payment_link AFTER INSERT ON stripe_invoice_charge_links FOR EACH ROW EXECUTE FUNCTION expire_payment_link();`);
  await assert.rejects(f.worker.runClaim(claim), LostJobClaim);
  assert.equal((await f.db.prepare('SELECT is_called FROM payment_publication_witness').get())?.is_called, true);
  for (const table of ['stripe_owned_invoice_ledger', 'stripe_invoice_charge_links', 'stripe_customer_ledger_snapshots']) {
    assert.equal((await f.db.prepare(`SELECT count(*)::integer AS count FROM ${table}`).get())?.count, 0);
  }
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('legacy observation payloads remain explicitly unevaluated; compiled maintenance traces card funding without runtime development loaders or provider writes', async t => {
  const f = await fixture(t); await drain(f);
  await f.db.prepare("UPDATE stripe_owned_invoice_ledger SET payload=(payload::jsonb-'funding')::text").run();
  assert.equal(await funding(f), null);
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: f.config.databaseUrl!, PUBLIC_ORIGIN: f.origin,
    COOKIE_SECURE: 'true', OIDC_ISSUER: f.issuer, OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-client-secret', ...sandboxSettings };
  const code = `import Stripe from 'stripe'; import { runBillingCommand } from './dist-server/billing/cli.js';
    const client = new Stripe(process.env.STRIPE_TEST_SECRET_KEY, { host: '127.0.0.1', port: ${f.port}, protocol: 'http',
      apiVersion: '${stripeApiVersion}', maxNetworkRetries: 0, timeout: 1000 }); await runBillingCommand('reconcile', client);`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000 });
  assert.equal(JSON.parse(result.stdout).authority, 'sandbox-ledger-observation-only');
  assert.match(result.stderr, /billing.ledger.review-required/);
  assert.equal((await funding(f))?.state, 'settled');
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 2);
});
