import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { authJsEnvironment, openBillingFixture, sandboxSettings } from './fixtures/billing';
import { sandboxServicePolicy } from '../shared/billing-ledger';
import { Entitlements } from '../server/entitlements';
import { assertBillingConfiguration, BillingNotifications } from '../server/billing';
import { checkoutRowSchema } from '../server/billing/checkout-schema';
import { invoiceFactSchema, subscriptionFactSchema } from '../server/billing/ledger-schema';
import { calendarServiceEnd, evaluateSandboxService } from '../server/billing/service-policy';
import { stripeApiVersion } from '../server/billing/schema';
import { LostJobClaim, TerminalJobFailure } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';
import { digest } from '../server/jobs/schema';
import { problems } from '../shared/catalog';
import { setTimeout as delay } from 'node:timers/promises';

const optIn = { STRIPE_TEST_ACCESS_POLICY: sandboxServicePolicy };
async function fixture(t: TestContext, offer: 'pro_monthly' | 'pro_annual' = 'pro_monthly', enabled = true) {
  const f = await openBillingFixture(t, enabled ? optIn : {}), login = await f.login(), intent = await f.reserve(login.browser, offer);
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  const facts = await f.settleCheckout();
  assert.equal((await login.browser.request(`/api/billing/checkouts/${intent.id}/refresh`, {})).status, 200);
  await f.complete('billing.checkout.refresh');
  assert.ok(f.config.billing);
  return { ...f, owner: login.owner, ownerBrowser: login.browser, facts, settings: f.config.billing };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function drain(f: Fixture) {
  for (let count = 0; count < 4; count++) {
    const claim = await f.worker.jobs.claim('billing.customer.snapshot');
    if (!claim) return;
    await f.worker.runClaim(claim);
  }
  assert.fail('Customer generations must converge.');
}
async function refresh(f: Fixture) {
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202); await drain(f);
}
async function service(f: Fixture) { return (await f.view(f.ownerBrowser)).ledger?.invoices[0].service; }
function reversal(f: Fixture, amount = 1900, status = 'succeeded') {
  const value = { id: 're_Service', object: 'refund', charge: f.facts.charge.id, payment_intent: f.facts.intent.id,
    customer: f.facts.charge.customer, currency: 'usd', amount, status };
  f.refunds.set(value.id, value); f.facts.charge.amount_refunded = amount;
  f.facts.charge.refunded = amount === f.facts.charge.amount;
  return value;
}
async function normalized(f: Fixture) {
  const invoice = await f.db.prepare('SELECT payload FROM stripe_owned_invoice_ledger').get(),
    sub = await f.db.prepare('SELECT payload FROM stripe_owned_subscription_ledger').get(),
    attempt = await f.db.prepare('SELECT * FROM stripe_checkout_attempts').get();
  assert.ok(invoice && sub && attempt);
  return { invoice: invoiceFactSchema.parse(JSON.parse(String(invoice.payload))), sub: subscriptionFactSchema.parse(JSON.parse(String(sub.payload))),
    attempt: checkoutRowSchema.parse(attempt) };
}
function renewal(f: Fixture, start: number, until: number) {
  const invoice = structuredClone(f.facts.invoice), line = structuredClone(f.facts.line), payment = structuredClone(f.facts.payment),
    charge = structuredClone(f.facts.charge), intent = structuredClone(f.facts.intent);
  invoice.id = 'in_ServiceRenewal'; invoice.created = start; invoice.status_transitions.paid_at = start; invoice.billing_reason = 'subscription_cycle';
  line.id = 'il_ServiceRenewal'; line.invoice = invoice.id; line.period = { start, end: until - 1 };
  payment.id = 'inpay_ServiceRenewal'; payment.invoice = invoice.id; payment.payment.payment_intent = 'pi_ServiceRenewal';
  charge.id = 'ch_ServiceRenewal'; charge.payment_intent = 'pi_ServiceRenewal';
  intent.id = 'pi_ServiceRenewal'; intent.latest_charge = charge.id;
  invoice.lines.data = [line]; invoice.payments.data = [payment];
  f.invoices.set(invoice.id, invoice); f.invoiceLines.set(invoice.id, [line]); f.invoicePayments.set(invoice.id, [payment]);
  f.charges.set(charge.id, charge); f.paymentIntents.set(intent.id, intent);
  f.facts.sub.latest_invoice = invoice.id;
  Object.assign(f.facts.sub.items.data[0], { current_period_start: start, current_period_end: until });
  return { invoice, line, payment, charge, intent };
}

test('UTC calendar service boundaries preserve original monthly anchors, leap years and exact exclusive ends', () => {
  const seconds = (value: string) => Date.parse(value) / 1000;
  for (const [start, anchor, offer, end] of [
    ['2025-01-31T10:11:12Z', '2025-01-31T10:11:12Z', 'pro_monthly', '2025-02-28T10:11:12Z'],
    ['2025-02-28T10:11:12Z', '2025-01-31T10:11:12Z', 'pro_monthly', '2025-03-31T10:11:12Z'],
    ['2025-02-28T10:11:12Z', '2025-01-30T10:11:12Z', 'pro_monthly', '2025-03-30T10:11:12Z'],
    ['2024-02-29T23:59:59Z', '2024-02-29T23:59:59Z', 'pro_annual', '2025-02-28T23:59:59Z'],
    ['2027-02-28T23:59:59Z', '2024-02-29T23:59:59Z', 'pro_annual', '2028-02-29T23:59:59Z'],
  ] as const) assert.equal(calendarServiceEnd(seconds(start), seconds(anchor), offer), Date.parse(end));
  assert.equal(calendarServiceEnd(seconds('2025-02-27T10:11:12Z'), seconds('2025-01-31T10:11:12Z'), 'pro_monthly'), null);
  assert.equal(calendarServiceEnd(seconds('2025-02-28T10:11:13Z'), seconds('2025-01-31T10:11:12Z'), 'pro_monthly'), null);
  assert.equal(calendarServiceEnd(seconds('9999-12-31T00:00:00Z'), seconds('9999-12-31T00:00:00Z'), 'pro_monthly'), null);
});

test('sandbox policy is opt-in; ordinary sandbox settlement remains observation-only with no source or grant', async t => {
  const f = await fixture(t, 'pro_monthly', false); await drain(f);
  assert.equal((await f.view(f.ownerBrowser)).accessAuthority, 'none'); assert.equal(await service(f), null);
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
  for (const table of ['stripe_invoice_service_evidence', 'entitlement_grants', 'entitlement_events']) {
    assert.equal((await f.db.prepare(`SELECT count(*)::integer AS count FROM ${table}`).get())?.count, 0);
  }
});

test('owned monthly and annual proof issues one immutable expiring sandbox Pro source; replay/cancel flags never extend or duplicate it', async t => {
  for (const offer of ['pro_monthly', 'pro_annual'] as const) {
    const f = await fixture(t, offer); await drain(f);
    assert.equal((await f.view(f.ownerBrowser)).accessAuthority, sandboxServicePolicy);
    assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'pro');
    const proof = await service(f); assert.equal(proof?.state, 'granted');
    assert.equal(proof?.endsAt, new Date((f.facts.line.period.end + 1) * 1000).toISOString());
    const original = await f.db.prepare('SELECT id,request_hash,starts_at,ends_at FROM entitlement_grants').get(); assert.ok(original);
    f.facts.sub.cancel_at_period_end = true; await refresh(f); await refresh(f);
    assert.deepEqual(await f.db.prepare('SELECT id,request_hash,starts_at,ends_at FROM entitlement_grants').get(), original);
    assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_events').get())?.count, 1);
    assert.equal((await f.ownerBrowser.bootstrap()).capabilities.commerce, 'disabled');
    for (const secret of ['stripe-test-v1:', 'pi_Synthetic', 'ch_Synthetic', 'price_Synthetic', 'private-card-contact']) {
      assert.ok(!JSON.stringify(await f.view(f.ownerBrowser)).includes(secret));
    }
    assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.features.find(feature => feature.key === 'ai.feedback.consume')?.allowed, false);
  }
});

test('eligibility verifies captured quote, line/item/customer/checkout, method/reason, calendar and real card allocations rather than a settled label', async t => {
  const f = await fixture(t); await drain(f); const facts = await normalized(f);
  assert.equal(evaluateSandboxService(facts.invoice, facts.sub, facts.attempt, facts.attempt.customer_ref, []).decision, 'eligible');
  const mutations: ((value: typeof facts) => void)[] = [
    value => { value.invoice.lines[0].periodEnd++; }, value => { value.invoice.lines[0].periodStart++; },
    value => { value.invoice.lines[0].itemId = 'si_Foreign'; }, value => { value.invoice.lines[0].quantityDecimal = '1.1'; },
    value => { value.invoice.lines[0].proration = true; }, value => { value.invoice.lines[0].priceId = 'price_Foreign'; },
    value => { value.invoice.lines.push(structuredClone(value.invoice.lines[0])); },
    value => { value.attempt.unit_amount = 1; }, value => { value.attempt.subscription_id = 'sub_Foreign'; },
    value => { value.attempt.customer_ref = '12345678-1234-4234-8234-123456789abc'; },
    value => { value.attempt.state = 'open'; }, value => { value.invoice.billingReason = 'manual'; },
    value => { value.invoice.collectionMethod = 'send_invoice'; }, value => { value.sub.status = 'trialing'; },
    value => { value.sub.billingCycleAnchor = null; }, value => { value.sub.anchorConfigured = true; },
    value => { assert.ok(value.invoice.funding); value.invoice.funding.intents = []; },
    value => { assert.ok(value.invoice.funding); value.invoice.funding.charges[0].amount++; },
    value => { assert.ok(value.invoice.funding); value.invoice.funding.charges[0].intentId = 'pi_Foreign'; },
    value => { assert.ok(value.invoice.funding); value.invoice.funding.charges[0].method = 'sepa_debit'; },
    value => { assert.ok(value.invoice.funding); value.invoice.funding.intents[0].allocations.push({
      id: 'inpay_Foreign', invoiceId: 'in_Foreign', status: 'paid', amountPaid: 1900,
    }); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(facts); mutate(changed);
    const result = evaluateSandboxService(changed.invoice, changed.sub, changed.attempt, facts.attempt.customer_ref, []);
    assert.equal(result.decision, 'held'); assert.ok(result.reviewReasons.length);
  }
  assert.equal(evaluateSandboxService(facts.invoice, facts.sub, facts.attempt, facts.attempt.customer_ref, ['duplicate-subscriptions']).decision, 'held');
});

test('an unsupported service line is held without grant; correction can issue, but later paid-period movement cannot mutate that source', async t => {
  const f = await fixture(t); f.facts.line.period.end++; await drain(f);
  assert.equal((await service(f))?.state, 'held'); assert.ok((await service(f))?.reviewReasons.includes('calendar-period-unsupported'));
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
  f.facts.line.period.end--; await refresh(f); assert.equal((await service(f))?.state, 'granted');
  const until = f.facts.sub.items.data[0].current_period_end, nextEnd = new Date(until * 1000);
  nextEnd.setUTCMonth(nextEnd.getUTCMonth() + 1);
  f.facts.line.period = { start: until, end: nextEnd.getTime() / 1000 - 1 };
  Object.assign(f.facts.sub.items.data[0], { current_period_start: until, current_period_end: nextEnd.getTime() / 1000 });
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal((await service(f))?.endsAt, new Date(until * 1000).toISOString());
});

test('pending refunds hold new issuance without retiring settled access; succeeded partial/full reversal terminally retires only its invoice source', async t => {
  const f = await fixture(t); await drain(f);
  const problem = problems.find(problem => problem.premium); assert.ok(problem);
  assert.equal((await f.ownerBrowser.request(`/api/content/problems/${problem.id}`)).status, 200);
  assert.equal((await f.ownerBrowser.request('/api/mocks', { problemId: problem.id, company: 'Meta', level: 'Senior', length: 3 })).status, 200);
  const archived = (await f.ownerBrowser.bootstrap()).state.mocks;
  const pending = reversal(f, 500, 'pending'); await refresh(f);
  assert.equal((await service(f))?.state, 'granted'); assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'pro');
  pending.status = 'succeeded'; await refresh(f);
  assert.equal((await service(f))?.state, 'revoked'); assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
  assert.equal((await f.ownerBrowser.request(`/api/content/problems/${problem.id}`)).status, 403);
  assert.equal((await f.ownerBrowser.request('/api/mocks', { problemId: problem.id, company: 'Meta', level: 'Senior', length: 3 })).status, 403);
  assert.deepEqual((await f.ownerBrowser.bootstrap()).state.mocks, archived);
  pending.amount = 1900; f.facts.charge.amount_refunded = 1900; f.facts.charge.refunded = true;
  await assert.rejects(refresh(f), TerminalJobFailure, 'A succeeded refund cannot change its original amount.');
});

test('a late-paid calendar interval expires at its exact exclusive database-clock boundary without changing or deleting the grant', async t => {
  const f = await fixture(t), until = Math.floor(Date.now() / 1000) + 8, start = new Date(until * 1000);
  start.setUTCMonth(start.getUTCMonth() - 1); const from = start.getTime() / 1000;
  f.facts.invoice.created = from; f.facts.sub.billing_cycle_anchor = from;
  f.facts.line.period = { start: from, end: until - 1 };
  Object.assign(f.facts.sub.items.data[0], { current_period_start: from, current_period_end: until });
  await drain(f); assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'pro');
  const original = await f.db.prepare('SELECT id,ends_at,request_hash FROM entitlement_grants').get(); assert.ok(original);
  await delay(Math.max(0, until * 1000 - Date.now() + 25));
  const access = (await f.ownerBrowser.bootstrap()).capabilities.access; assert.ok(access);
  assert.ok(Date.parse(access.serverTime) >= until * 1000); assert.equal(access.state, 'free');
  assert.equal(access.features.find(feature => feature.key === 'mock.create')?.reason, 'expired');
  assert.deepEqual(await f.db.prepare('SELECT id,ends_at,request_hash FROM entitlement_grants').get(), original);
});

test('canonical dispute and issued credit retire scoped sandbox grants; winning or voiding never restores a terminal source', async t => {
  for (const family of ['dispute', 'credit'] as const) {
    const f = await fixture(t); await drain(f);
    if (family === 'dispute') {
      const value = { id: 'dp_Service', object: 'dispute', charge: f.facts.charge.id, payment_intent: f.facts.intent.id,
        livemode: false, currency: 'usd', amount: 1900, status: 'needs_response' };
      f.disputes.set(value.id, value); f.facts.charge.disputed = true; await refresh(f);
      value.status = 'won'; await refresh(f);
    } else {
      const value = { id: 'cn_Service', object: 'credit_note', customer: f.facts.charge.customer, invoice: f.facts.invoice.id,
        livemode: false, currency: 'usd', amount: 500, status: 'issued' };
      f.credits.set(value.id, value); await refresh(f); value.status = 'void'; await refresh(f);
    }
    assert.equal((await service(f))?.state, 'revoked'); assert.ok((await service(f))?.reviewReasons.includes('terminal-source'));
    assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
    assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_revocations').get())?.count, 1);
    assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_events').get())?.count, 2);
  }
});

test('adjustment-before-issuance creates a terminal tombstone; later voiding it cannot turn that same invoice into a grant', async t => {
  const f = await fixture(t);
  const value = { id: 'cn_BeforeIssue', object: 'credit_note', customer: f.facts.charge.customer, invoice: f.facts.invoice.id,
    livemode: false, currency: 'usd', amount: 500, status: 'issued' };
  f.credits.set(value.id, value); await drain(f); value.status = 'void'; await refresh(f);
  assert.equal((await service(f))?.state, 'revoked');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
});

test('historical full refund targets its expired interval, never erases a current renewal or independent promotion', async t => {
  const f = await fixture(t), current = f.facts.line.period.start, previous = new Date(current * 1000);
  previous.setUTCMonth(previous.getUTCMonth() - 1); const start = previous.getTime() / 1000;
  f.facts.invoice.created -= 120 * 86400; f.facts.invoice.status_transitions.paid_at = start;
  f.facts.line.period = { start, end: current - 1 }; f.facts.sub.billing_cycle_anchor = start;
  Object.assign(f.facts.sub.items.data[0], { current_period_start: start, current_period_end: current });
  await drain(f); assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
  const next = new Date(current * 1000); next.setUTCMonth(next.getUTCMonth() + 1); renewal(f, current, next.getTime() / 1000);
  await refresh(f); assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'pro');
  await new Entitlements(f.db).issue({ owner: f.owner, source: { kind: 'promotion', key: 'independent-service-fixture' }, policy: 'pro-v1',
    startsAt: current * 1000, endsAt: next.getTime(), evidence: { actor: 'synthetic-fixture', reason: 'Independent bounded promotion test.' } });
  const value = reversal(f);
  await f.notify('refund', value, 'refund.updated'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'pro');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 3);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_revocations').get())?.count, 1);
});

test('scope/source ownership, suspended owners and persisted policy configuration cannot be bypassed', async t => {
  const f = await fixture(t); await drain(f);
  await assert.rejects(assertBillingConfiguration(f.db, { ...f.settings, accessPolicy: null }), /explicit account and versioned access policy/);
  await assertBillingConfiguration(f.db, { ...f.settings, offers: null });
  await f.db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(f.owner);
  const value = reversal(f); await f.notify('refund', value, 'refund.updated'); await f.complete('billing.reconcile'); await drain(f);
  assert.equal((await new Entitlements(f.db).view(f.owner)).state, 'restricted');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_revocations').get())?.count, 1);
});

test('a running replica opened before opt-in cannot silently drop reversal authority or describe it as observation-only', async t => {
  const f = await fixture(t), shutdown = new AbortController();
  const old = await BillingNotifications.open(f.db, { ...f.settings, accessPolicy: null }, shutdown.signal, true, f.client, f.origin);
  f.cleanup.push(async () => { shutdown.abort(); await old.close(); });
  assert.ok(old.checkout);
  await drain(f); await assert.rejects(old.checkout.view(f.owner), /versioned access policy/);
  reversal(f);
  assert.equal((await f.ownerBrowser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await old.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await assert.rejects(old.runClaim(claim), /versioned access policy/);
  assert.equal((await old.jobs.operation(claim.data.operationId)).receipt, null);
  await f.worker.runClaim(claim); assert.equal((await service(f))?.state, 'revoked');
});

test('late line/anchor movement cannot issue; a known dirty revision completes as superseded and converges instead of retrying stale evidence', async t => {
  const f = await fixture(t); await f.complete('billing.customer.snapshot');
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  f.barrier(async path => { if (path === `/v1/invoices/${f.facts.invoice.id}`) f.facts.line.period.end++; });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); f.facts.line.period.end--; f.barrier();
  let changed = false;
  f.barrier(async path => {
    if (path !== `/v1/subscriptions/${f.facts.sub.id}` || changed) return;
    changed = true; f.facts.sub.cancel_at_period_end = true;
    await f.notify('subscription', f.facts.sub, 'customer.subscription.updated'); await f.complete('billing.reconcile');
  });
  await f.worker.runClaim(claim); f.barrier();
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt?.superseded, true);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  await drain(f); assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'pro');
});

test('actual lease expiry after grant/audit SQL rolls financial rows, service authority, audit, receipt and queue completion back', async t => {
  const f = await fixture(t); await f.complete('billing.customer.snapshot');
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  const row = await f.db.prepare("SELECT job_id FROM durable_operations WHERE kind='billing.customer.snapshot' AND completed_at IS NULL").get(); assert.ok(row);
  await boss.update('billing-customer-snapshot', undefined, { id: String(row.job_id), expireInSeconds: 2 });
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE service_publication_witness;
    CREATE FUNCTION expire_service_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('service_publication_witness'); PERFORM pg_sleep(2.1); RETURN NEW; END $body$;
    CREATE TRIGGER expire_service_publication AFTER INSERT ON stripe_invoice_service_evidence FOR EACH ROW EXECUTE FUNCTION expire_service_publication();`);
  await assert.rejects(f.worker.runClaim(claim), LostJobClaim);
  assert.equal((await f.db.prepare('SELECT is_called FROM service_publication_witness').get())?.is_called, true);
  for (const table of ['entitlement_grants', 'entitlement_events', 'stripe_invoice_service_evidence', 'stripe_owned_invoice_ledger', 'stripe_customer_ledger_snapshots']) {
    assert.equal((await f.db.prepare(`SELECT count(*)::integer AS count FROM ${table}`).get())?.count, 0);
  }
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('a foreign source tombstone cannot lend its authority or be reassigned to an owned invoice', async t => {
  const f = await fixture(t), other = await f.login(f.browser(), 'auth0|service-foreign-owner');
  await new Entitlements(f.db).revoke(other.owner, { kind: 'billing', key: `stripe-test-v1:${digest(`${f.settings.accountId}:${f.facts.invoice.id}`)}` },
    { actor: 'synthetic-fixture', reason: 'Foreign source ownership collision test.' });
  await f.complete('billing.customer.snapshot');
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'free');
});

test('deletion inside actual service SQL fences completion and rolls new authority and owner retirement back', async t => {
  const f = await fixture(t); await f.complete('billing.customer.snapshot');
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE service_deletion_witness;
    CREATE FUNCTION retire_service_owner() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('service_deletion_witness');
      DELETE FROM users WHERE id=(SELECT user_id FROM stripe_owned_customers WHERE id=NEW.customer_ref);
      RETURN NEW; END $body$;
    CREATE TRIGGER retire_service_owner AFTER INSERT ON stripe_invoice_service_evidence FOR EACH ROW EXECUTE FUNCTION retire_service_owner();`);
  await assert.rejects(f.worker.runClaim(claim));
  assert.equal((await f.db.prepare('SELECT is_called FROM service_deletion_witness').get())?.is_called, true);
  for (const table of ['entitlement_grants', 'entitlement_events', 'entitlement_revocations', 'stripe_invoice_service_evidence', 'stripe_owned_invoice_ledger']) {
    assert.equal((await f.db.prepare(`SELECT count(*)::integer AS count FROM ${table}`).get())?.count, 0);
  }
  assert.equal((await f.db.prepare('SELECT id FROM users WHERE id=?').get(f.owner))?.id, f.owner);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('compiled maintained reconciliation issues gated sandbox service authority without dev loaders and fails closed if policy is removed', async t => {
  const f = await fixture(t);
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: f.config.databaseUrl!,
    ...authJsEnvironment(f.origin), ...sandboxSettings, ...optIn };
  const code = `import Stripe from 'stripe'; import { runBillingCommand } from './dist-server/billing/cli.js';
    const client = new Stripe(process.env.STRIPE_TEST_SECRET_KEY, { host: '127.0.0.1', port: ${f.port}, protocol: 'http',
      apiVersion: '${stripeApiVersion}', maxNetworkRetries: 0, timeout: 1000 }); await runBillingCommand('reconcile', client);`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000 });
  assert.equal(JSON.parse(result.stdout).authority, sandboxServicePolicy);
  assert.equal((await f.ownerBrowser.bootstrap()).capabilities.access?.state, 'pro');
  const { STRIPE_TEST_ACCESS_POLICY: _, ...disabled } = env;
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env: disabled, timeout: 15000 }));
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 1);
});
