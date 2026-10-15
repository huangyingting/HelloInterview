import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authJsEnvironment, openBillingFixture, sandboxSettings } from './fixtures/billing';
import { sandboxResumptionAuthority, sandboxRenewalAuthority, sandboxRenewalCycleAuthority, sandboxServicePolicy } from '../shared/billing-ledger';
import { LostJobClaim, TerminalJobFailure } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';
import { BillingNotifications } from '../server/billing';
import { postgresConnection } from '../server/db/connection';
import { migrations, migrateDatabase, assertDatabaseVersion } from '../server/db/migrations';
import { stripeApiVersion } from '../server/billing/schema';
import { problems } from '../shared/catalog';

async function fixture(t: TestContext, service = false, offer: 'pro_monthly' | 'pro_annual' = 'pro_monthly') {
  const f = await openBillingFixture(t, service ? { STRIPE_TEST_ACCESS_POLICY: sandboxServicePolicy } : {}), { browser, owner } = await f.login();
  const attempt = await f.reserve(browser, offer); await f.complete('billing.customer'); await f.complete('billing.checkout');
  const facts = await f.settleCheckout();
  assert.equal((await browser.request(`/api/billing/checkouts/${attempt.id}/refresh`, {})).status, 200);
  await f.complete('billing.checkout.refresh'); await f.complete('billing.customer.snapshot'); await f.complete('billing.customer.snapshot');
  const sub = (await f.view(browser)).ledger?.subscriptions[0]; assert.ok(sub);
  const cancelUrl = `/api/billing/subscriptions/${sub.id}/cancel`, url = `/api/billing/subscriptions/${sub.id}/resume`;
  const response = await browser.request(cancelUrl, {}); assert.equal(response.status, 202);
  const cancellation: { id: string } = await response.json();
  await f.complete('billing.subscription.cancel'); await f.complete('billing.customer.snapshot');
  return { ...f, browser, owner, facts, sub, cancelUrl, url, cancellation };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const body = (f: Fixture) => ({ cancellationId: f.cancellation.id, acknowledged: true as const });
async function reserve(f: Fixture) {
  const response = await f.browser.request(f.url, body(f));
  assert.equal(response.status, 202, await response.clone().text());
  const value: { id: string; accepted: boolean } = await response.json(); assert.equal(value.accepted, true); return value;
}
const posts = (f: Fixture) => f.requests.filter(request => request.method === 'POST' && request.path.startsWith('/v1/subscriptions/') &&
  JSON.stringify(request.body).includes('"cancel_at_period_end":"false"'));
async function resumption(f: Fixture) { return (await f.view(f.browser)).ledger?.subscriptions[0].cancellation?.resumption; }
async function refresh(f: Fixture) {
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202); await f.complete('billing.customer.snapshot');
}

test('resumption requires strict acknowledged fresh owned admission, CSRF and opaque app targets, with replica deduplication', async t => {
  const f = await fixture(t);
  assert.equal((await f.browser.request(f.url, body(f), 'POST', { 'X-CSRF-Token': 'wrong' })).status, 403);
  for (const input of [{}, { cancellationId: f.cancellation.id }, { ...body(f), acknowledged: false },
    { ...body(f), subscription: f.facts.sub.id }, { ...body(f), price: 'price_Foreign' }, { ...body(f), prorate: true }]) {
    assert.equal((await f.browser.request(f.url, input)).status, 400);
  }
  assert.equal((await f.browser.request(`/api/billing/subscriptions/${f.facts.sub.id}/resume`, body(f))).status, 400);
  assert.equal((await f.browser.request(`/api/billing/subscriptions/${randomUUID()}/resume`, body(f))).status, 404);
  assert.equal((await f.browser.request(f.url, { ...body(f), cancellationId: randomUUID() })).status, 404);
  const stranger = await f.login(undefined, 'auth0|resumption-stranger');
  assert.equal((await stranger.browser.request(f.url, body(f))).status, 404);
  const replica = await f.replica(), browser = replica.browser();
  for (const [key, value] of f.browser.cookies) browser.cookies.set(key, value);
  await browser.bootstrap();
  const [first, second] = await Promise.all([reserve(f), browser.request(f.url, body(f))]);
  assert.equal(second.status, 202); assert.equal((await second.json()).id, first.id); assert.equal((await reserve(f)).id, first.id);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_subscription_resumptions').get())?.count, 1);
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.subscription.resume'").get())?.count, 1);
  assert.equal((await resumption(f))?.state, 'queued'); assert.equal(posts(f).length, 0);
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=authenticated_at-660000 WHERE token IN (SELECT token FROM sessions WHERE user_id=?)').run(f.owner);
  assert.equal((await f.browser.request(f.url, body(f))).status, 403);
});

test('exact eight-call same-quote renewal confirmation leaves paid sources, audits, funding, access and owned work unchanged', async t => {
  const f = await fixture(t, true), grants = await f.db.prepare('SELECT * FROM entitlement_grants').all(),
    events = await f.db.prepare('SELECT * FROM entitlement_events').all(),
    service = await f.db.prepare('SELECT invoice_id,source_key,policy_version,payload FROM stripe_invoice_service_evidence').all(), funding = structuredClone(f.facts.invoice),
    cancellation = await f.db.prepare('SELECT * FROM stripe_subscription_cancellations').get();
  const problem = problems.find(problem => problem.premium); assert.ok(problem);
  assert.equal((await f.browser.request('/api/mocks', { problemId: problem.id, company: 'Meta', level: 'Senior', length: 3 })).status, 200);
  const archive = (await f.browser.bootstrap()).state.mocks;
  const intent = await reserve(f), before = f.requests.length, operation = await f.complete('billing.subscription.resume');
  assert.equal(f.requests.length - before, 8);
  assert.deepEqual(operation.receipt, { resumptionId: intent.id, cancellationId: f.cancellation.id, result: 'renewing', authority: sandboxResumptionAuthority });
  assert.deepEqual(posts(f).map(request => ({ key: request.key, body: request.body })), [{
    key: operation.id, body: { cancel_at_period_end: 'false', proration_behavior: 'none' },
  }]);
  assert.equal((await resumption(f))?.state, 'confirmed'); assert.equal((await f.view(f.browser)).ledger?.stale, true);
  await f.complete('billing.customer.snapshot'); assert.equal((await f.view(f.browser)).ledger?.subscriptions[0].nonrenewing, false);
  assert.deepEqual(await f.db.prepare('SELECT * FROM stripe_subscription_cancellations').get(), cancellation);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_grants').all(), grants);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_events').all(), events);
  assert.deepEqual(await f.db.prepare('SELECT invoice_id,source_key,policy_version,payload FROM stripe_invoice_service_evidence').all(), service);
  assert.deepEqual(f.facts.invoice, funding); assert.deepEqual((await f.browser.bootstrap()).state.mocks, archive);
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'pro');
  assert.equal((await f.browser.request(`/api/content/problems/${problem.id}`)).status, 200);
  assert.equal((await reserve(f)).id, intent.id); assert.equal(posts(f).length, 1);
  for (const secret of ['cus_Synthetic', 'sub_Synthetic', 'price_Synthetic', 'eligibilityProof', 'authEpoch', 'in_Synthetic']) {
    assert.ok(!JSON.stringify(await f.view(f.browser)).includes(secret));
  }
});

test('funded observation-only annual renewal can resume without issuing any entitlement or enabling production commerce', async t => {
  const f = await fixture(t, false, 'pro_annual'); await reserve(f); await f.complete('billing.subscription.resume'); await f.complete('billing.customer.snapshot');
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'free');
  assert.equal((await f.browser.bootstrap()).capabilities.commerce, 'disabled');
  assert.equal((await f.view(f.browser)).accessAuthority, 'none');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_invoice_service_evidence').get())?.count, 0);
});

test('dirty, stale or future-dated observations cannot authorize a new resumption or substitute for current funding', async t => {
  const f = await fixture(t);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  assert.equal((await f.browser.request(f.url, body(f))).status, 409); await f.complete('billing.customer.snapshot');
  for (const age of ["clock_timestamp()-interval '5 minutes'", "clock_timestamp()+interval '1 minute'"]) {
    await f.db.exec(`UPDATE stripe_customer_ledger_state SET observed_at=${age}`);
    assert.equal((await f.browser.request(f.url, body(f))).status, 409);
  }
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_subscription_resumptions').get())?.count, 0);
  assert.equal(posts(f).length, 0);
});

test('ended, externally changed and unconfirmed owned cancellation states never admit future-renewal consent', async t => {
  for (const change of [{ status: 'canceled' }, { status: 'past_due' }, { cancel_at_period_end: false, cancel_at: null }]) {
    const f = await fixture(t); Object.assign(f.facts.sub, change); await refresh(f);
    assert.equal((await f.browser.request(f.url, body(f))).status, 409);
  }
  const f = await fixture(t);
  await f.db.prepare("UPDATE stripe_subscription_cancellations SET state='queued',confirmed_at=NULL,result=NULL").run();
  assert.equal((await f.browser.request(f.url, body(f))).status, 409); assert.equal(posts(f).length, 0);
});

test('refunded, disputed, credited or unsupported calendar funding holds resumption even without sandbox grant issuance', async t => {
  for (const family of ['dispute', 'refund', 'credit', 'calendar']) {
    const f = await fixture(t);
    if (family === 'dispute') {
      f.disputes.set('dp_Resumption', { id: 'dp_Resumption', object: 'dispute', charge: f.facts.charge.id,
        payment_intent: f.facts.intent.id, livemode: false, currency: 'usd', amount: 1900, status: 'needs_response' });
      f.facts.charge.disputed = true;
    } else if (family === 'refund') {
      f.refunds.set('re_Resumption', { id: 're_Resumption', object: 'refund', charge: f.facts.charge.id,
        payment_intent: f.facts.intent.id, customer: f.facts.charge.customer, currency: 'usd', amount: 1900, status: 'succeeded' });
      f.facts.charge.amount_refunded = 1900; f.facts.charge.refunded = true;
    } else if (family === 'credit') {
      f.credits.set('cn_Resumption', { id: 'cn_Resumption', object: 'credit_note', customer: f.facts.charge.customer,
        invoice: f.facts.invoice.id, currency: 'usd', amount: 500, livemode: false, status: 'issued' });
    } else f.facts.line.period.end -= 3600;
    await refresh(f);
    assert.equal((await f.browser.request(f.url, body(f))).status, 409);
    assert.equal(posts(f).length, 0); assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_subscription_resumptions').get())?.count, 0);
  }
});

test('withdrawn or remapped offers block new consent and queued writes without blocking historical read-only recovery', async t => {
  const f = await fixture(t); assert.ok(f.config.billing);
  const shutdown = new AbortController(), changed = await BillingNotifications.open(f.db, { ...f.config.billing, offers: null }, shutdown.signal, true, f.client, f.origin);
  f.cleanup.push(async () => { shutdown.abort(); await changed.close(); }); assert.ok(changed.checkout);
  const remapped = await BillingNotifications.open(f.db, { ...f.config.billing,
    offers: { pro_monthly: 'price_Remapped', pro_annual: 'price_SyntheticAnnual' } }, shutdown.signal, true, f.client, f.origin);
  f.cleanup.push(() => remapped.close()); assert.ok(remapped.checkout);
  await assert.rejects(changed.checkout.resumeRenewal(f.owner, f.sub.id, body(f)), /still-enabled reference offer/);
  await assert.rejects(remapped.checkout.resumeRenewal(f.owner, f.sub.id, body(f)), /still-enabled reference offer/);
  await reserve(f); const claim = await changed.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  await assert.rejects(changed.runClaim(claim), /still-enabled reference offer/); assert.equal(posts(f).length, 0);
  await assert.rejects(remapped.runClaim(claim), /still-enabled reference offer/); assert.equal(posts(f).length, 0);
  f.facts.sub.cancel_at_period_end = false; f.facts.sub.cancel_at = null;
  const before = f.requests.length; await changed.runClaim(claim); assert.equal(f.requests.length - before, 5);
  assert.equal((await resumption(f))?.state, 'confirmed'); assert.equal(posts(f).length, 0);
});

test('foreign scope, unsupported fiscal features, custom dates and captured period, anchor, invoice or item drift fail before SDK write', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  const original = structuredClone(f.facts.sub), item = original.items.data[0];
  const changes: (() => void)[] = [
    () => f.account('acct_Foreign'),
    () => { f.facts.sub.customer = 'cus_Foreign'; },
    () => { f.facts.sub.metadata.studio_checkout_ref = randomUUID(); },
    () => { f.facts.sub.items.data[0].price.id = 'price_Foreign'; },
    () => { f.facts.sub.items.data[0].id = 'si_Foreign'; },
    () => { f.facts.sub.items.data[0].current_period_start++; },
    () => { f.facts.sub.items.data[0].current_period_end++; },
    () => { f.facts.sub.billing_cycle_anchor++; },
    () => { f.facts.sub.latest_invoice = 'in_Foreign'; },
    () => Object.assign(f.facts.sub, { application: 'ca_Foreign' }),
    () => Object.assign(f.facts.sub, { on_behalf_of: 'acct_Foreign' }),
    () => Object.assign(f.facts.sub, { transfer_data: { destination: 'acct_Foreign' } }),
    () => Object.assign(f.facts.sub, { application_fee_percent: 1 }),
    () => Object.assign(f.facts.sub, { schedule: 'sub_sched_Foreign' }),
    () => Object.assign(f.facts.sub, { pending_update: {} }),
    () => Object.assign(f.facts.sub, { automatic_tax: { enabled: true } }),
    () => Object.assign(f.facts.sub, { pause_collection: { behavior: 'void' } }),
    () => Object.assign(f.facts.sub, { discounts: ['di_Foreign'] }),
    () => Object.assign(f.facts.sub, { default_tax_rates: ['txr_Foreign'] }),
    () => Object.assign(f.facts.sub.items.data[0], { tax_rates: ['txr_Foreign'] }),
    () => Object.assign(f.facts.sub.items.data[0], { discounts: ['di_Foreign'] }),
    () => Object.assign(f.facts.sub.items.data[0], { billing_thresholds: { usage_gte: 1 } }),
    () => Object.assign(f.facts.sub, { billing_thresholds: {} }),
    () => Object.assign(f.facts.sub, { pending_invoice_item_interval: {} }),
    () => Object.assign(f.facts.sub, { trial_end: item.current_period_end }),
    () => Object.assign(f.facts.sub, { cancel_at: item.current_period_end - 1 }),
    () => { f.facts.sub.items.has_more = true; },
  ];
  for (const change of changes) {
    Object.assign(f.facts.sub, structuredClone(original)); f.account(sandboxSettings.STRIPE_TEST_ACCOUNT_ID); change();
    await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 0);
    assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  }
});

test('inactive, repriced, different-cadence or wrong live-mode provider Price and product cannot be accepted as the original quote', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  const price = f.prices.get('price_SyntheticMonthly'); assert.ok(price); const original = structuredClone(price), product = structuredClone(f.product);
  for (const change of [{ active: false }, { unit_amount: 2000 }, { currency: 'eur' }, { livemode: true },
    { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } }, { product: null }]) {
    Object.assign(price, structuredClone(original), change);
    await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 0);
  }
  Object.assign(price, original); Object.assign(f.product, { active: false });
  await assert.rejects(f.worker.runClaim(claim)); Object.assign(f.product, product, { livemode: true });
  await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 0);
});

test('the write heartbeat precedes fresh native, owner and original mutation-window fences', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  const heartbeat = f.worker.jobs.heartbeat.bind(f.worker.jobs); let calls = 0;
  f.worker.jobs.heartbeat = async (current, signal) => {
    await heartbeat(current, signal);
    if (++calls === 6) await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
  };
  await assert.rejects(f.worker.runClaim(claim)); assert.equal(calls, 6); assert.equal(posts(f).length, 0);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('current funding becomes dirty before write rather than borrowing an earlier admitted eligible interval', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  f.barrier(async (path, method) => {
    if (path.startsWith('/v1/products/') && method === 'GET') {
      f.barrier(); await f.db.prepare('UPDATE stripe_customer_ledger_state SET requested_revision=requested_revision+1').run();
    }
  });
  await assert.rejects(f.worker.runClaim(claim), /Refresh the owned canonical ledger/); assert.equal(posts(f).length, 0);
});

test('a moved local customer mapping or quote cannot authorize the previously prepared target', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  f.barrier(async (path, method) => {
    if (path.startsWith('/v1/products/') && method === 'GET') {
      f.barrier(); await f.db.prepare("UPDATE stripe_owned_customers SET customer_id='cus_MovedMapping' WHERE user_id=?").run(f.owner);
    }
  });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 0);
  await f.db.prepare('UPDATE stripe_owned_customers SET customer_id=? WHERE user_id=?').run(String(f.facts.sub.customer), f.owner);
  await f.db.prepare('UPDATE stripe_checkout_attempts SET unit_amount=unit_amount+1').run();
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 0);
});

test('resumption admission security changes inside actual SQL roll intent and both maintained queue surfaces back', async t => {
  const f = await fixture(t);
  await f.db.executeSql(`CREATE SEQUENCE resumption_admission_witness;
    CREATE FUNCTION change_resumption_admission() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('resumption_admission_witness'); UPDATE managed_accounts SET session_epoch=session_epoch+1; RETURN NEW; END $body$;
    CREATE TRIGGER change_resumption_admission AFTER INSERT ON stripe_subscription_resumptions FOR EACH ROW EXECUTE FUNCTION change_resumption_admission();`);
  assert.equal((await f.browser.request(f.url, body(f))).status, 403);
  assert.equal((await f.db.prepare('SELECT is_called FROM resumption_admission_witness').get())?.is_called, true);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_subscription_resumptions').get())?.count, 0);
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.subscription.resume'").get())?.count, 0);
  assert.equal(await f.worker.jobs.claim('billing.subscription.resume'), undefined); assert.equal(posts(f).length, 0);
});

test('native expiry after actual confirmation SQL rolls resumption, dirty-ledger handoff and native completion back after external success', async t => {
  const f = await fixture(t); await reserve(f);
  const before = await f.db.prepare('SELECT requested_revision FROM stripe_customer_ledger_state').get();
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  const queued = await f.db.prepare("SELECT job_id FROM durable_operations WHERE kind='billing.subscription.resume'").get(); assert.ok(queued);
  await boss.update('billing-subscription-resume', undefined, { id: String(queued.job_id), expireInSeconds: 2 });
  const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE resumption_publication_witness;
    CREATE FUNCTION expire_resumption_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('resumption_publication_witness'); PERFORM pg_sleep(2.1); RETURN NEW; END $body$;
    CREATE TRIGGER expire_resumption_publication AFTER UPDATE ON stripe_subscription_resumptions FOR EACH ROW EXECUTE FUNCTION expire_resumption_publication();`);
  await assert.rejects(f.worker.runClaim(claim), LostJobClaim);
  assert.equal((await f.db.prepare('SELECT is_called FROM resumption_publication_witness').get())?.is_called, true);
  assert.deepEqual(await f.db.prepare('SELECT requested_revision FROM stripe_customer_ledger_state').get(), before);
  assert.equal((await f.db.prepare('SELECT state FROM stripe_subscription_resumptions').get())?.state, 'queued');
  assert.equal(f.facts.sub.cancel_at_period_end, false); assert.equal(posts(f).length, 1);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('unknown external success recovers read-only after the immutable 20-hour window without a second financial command', async t => {
  const f = await fixture(t); const intent = await reserve(f), claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  let reads = 0;
  f.barrier(async (path, method) => {
    if (path === `/v1/subscriptions/${f.facts.sub.id}` && method === 'GET' && ++reads === 2) f.outage(path);
  });
  await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 1); assert.equal(f.facts.sub.cancel_at_period_end, false);
  assert.equal((await resumption(f))?.state, 'queued'); assert.equal((await reserve(f)).id, intent.id);
  await f.db.prepare("UPDATE durable_operations SET created_at=clock_timestamp()-interval '21 hours' WHERE id=?").run(claim.data.operationId);
  f.barrier(); f.outage(''); const before = f.requests.length;
  await f.worker.runClaim(claim); assert.equal(f.requests.length - before, 5); assert.equal(posts(f).length, 1);
  assert.equal((await resumption(f))?.state, 'confirmed');
});

test('original expired or future-dated operation age cannot authorize a fresh SDK write', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  for (const value of ["clock_timestamp()-interval '20 hours'", "clock_timestamp()+interval '1 minute'"]) {
    await f.db.exec(`UPDATE durable_operations SET created_at=${value} WHERE id='${claim.data.operationId}'`);
    await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 0);
  }
});

test('cached resumption POST cannot override current reversal, changed period or a custom future cancellation date', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  const original = structuredClone(f.facts.sub); let reads = 0;
  f.barrier(async (path, method) => {
    if (path === `/v1/subscriptions/${f.facts.sub.id}` && method === 'GET' && ++reads === 2) {
      f.facts.sub.cancel_at_period_end = true;
    }
  });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 1);
  f.barrier(); Object.assign(f.facts.sub, structuredClone(original)); reads = 0;
  f.barrier(async (path, method) => {
    if (path === `/v1/subscriptions/${f.facts.sub.id}` && method === 'GET' && ++reads === 2) {
      f.facts.sub.cancel_at_period_end = false; f.facts.sub.cancel_at = null; f.facts.sub.items.data[0].current_period_end++;
    }
  });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 2);
  f.barrier(); Object.assign(f.facts.sub, structuredClone(original)); f.facts.sub.cancel_at_period_end = false;
  Object.assign(f.facts.sub, { cancel_at: original.items.data[0].current_period_end - 1 });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 2);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('security changes after final canonical observations fence publication without pretending the remote write was undone', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  let customerReads = 0;
  f.barrier(async (path, method) => {
    if (path.startsWith('/v1/customers/') && method === 'GET' && ++customerReads === 2) {
      await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
    }
  });
  await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 1);
  assert.equal(f.facts.sub.cancel_at_period_end, false);
  assert.equal((await f.db.prepare('SELECT state FROM stripe_subscription_resumptions').get())?.state, 'queued');
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('deletion during final canonical confirmation retains an unowned customer and never publishes or retries its resumption', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.resume'); assert.ok(claim);
  let customerReads = 0;
  f.barrier(async (path, method) => {
    if (path.startsWith('/v1/customers/') && method === 'GET' && ++customerReads === 2) await f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);
  });
  await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 1);
  const customer = await f.db.prepare('SELECT user_id FROM stripe_owned_customers').get(); assert.equal(customer?.user_id, null);
  assert.equal((await f.db.prepare('SELECT state FROM stripe_subscription_resumptions').get())?.state, 'queued');
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  const before = f.requests.length; await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(f.requests.length, before);
});

test('multiple immutable stop/resume cycles use exact predecessors and stale request replay cannot affect a later cycle', async t => {
  const f = await fixture(t); const first = await reserve(f);
  await f.complete('billing.subscription.resume'); await f.complete('billing.customer.snapshot');
  const initialCancellation = await f.db.prepare('SELECT * FROM stripe_subscription_cancellations WHERE id=?').get(f.cancellation.id);
  const initialResumption = await f.db.prepare('SELECT * FROM stripe_subscription_resumptions WHERE id=?').get(first.id);
  const canceled = await f.browser.request(f.cancelUrl, { previousResumptionId: first.id }); assert.equal(canceled.status, 202);
  const next: { id: string } = await canceled.json(); assert.notEqual(next.id, f.cancellation.id);
  await f.complete('billing.subscription.cancel'); await f.complete('billing.customer.snapshot');
  const later = (await f.view(f.browser)).ledger?.subscriptions[0].cancellation; assert.ok(later);
  assert.equal(later.id, next.id); assert.equal(later.cycle, 1); assert.equal(later.policy, sandboxRenewalCycleAuthority);
  assert.equal(later.previousResumptionId, first.id); assert.equal(later.resumption, null);
  const count = f.requests.length;
  const staleCancel = await f.browser.request(f.cancelUrl, {}); assert.equal(staleCancel.status, 202); assert.equal((await staleCancel.json()).id, f.cancellation.id);
  const staleResume = await reserve(f); assert.equal(staleResume.id, first.id);
  assert.equal(f.requests.length, count); assert.equal(f.facts.sub.cancel_at_period_end, true);
  const secondResponse = await f.browser.request(f.url, { cancellationId: next.id, acknowledged: true }); assert.equal(secondResponse.status, 202);
  const second: { id: string } = await secondResponse.json(); assert.notEqual(second.id, first.id);
  await f.complete('billing.subscription.resume'); await f.complete('billing.customer.snapshot');
  const secondStop = await f.browser.request(f.cancelUrl, { previousResumptionId: second.id }); assert.equal(secondStop.status, 202);
  await f.complete('billing.subscription.cancel'); await f.complete('billing.customer.snapshot');
  const final = (await f.view(f.browser)).ledger?.subscriptions[0].cancellation; assert.equal(final?.cycle, 2);
  const oldCycle = await f.browser.request(f.cancelUrl, { previousResumptionId: first.id }); assert.equal((await oldCycle.json()).id, next.id);
  assert.deepEqual(await f.db.prepare('SELECT * FROM stripe_subscription_cancellations WHERE id=?').get(f.cancellation.id), initialCancellation);
  assert.deepEqual(await f.db.prepare('SELECT * FROM stripe_subscription_resumptions WHERE id=?').get(first.id), initialResumption);
  assert.equal(posts(f).length, 2);
  assert.equal(new Set(f.requests.filter(request => request.method === 'POST' && request.path.startsWith('/v1/subscriptions/')).map(request => request.key)).size, 5);
});

test('an unknown queued resumption cannot authorize another stop cycle or a replacement consent', async t => {
  const f = await fixture(t); const intent = await reserve(f);
  assert.equal((await f.browser.request(f.cancelUrl, { previousResumptionId: intent.id })).status, 409);
  assert.equal((await f.browser.request(f.cancelUrl, { previousResumptionId: randomUUID() })).status, 404);
  const row = await f.db.prepare('SELECT operation_id FROM stripe_subscription_resumptions').get(); assert.ok(row);
  const operation = await f.worker.jobs.operation(String(row.operation_id)), boss = await createBoss(f.db);
  await boss.start(); f.cleanup.push(() => boss.stop()); await boss.cancel('billing-subscription-resume', operation.jobId);
  assert.equal((await f.browser.request(f.url, body(f))).status, 409);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_subscription_resumptions').get())?.count, 1);
});

test('migration 15 preserves actual migration-14 cancellation IDs, payloads and confirmations while backfilling the first cycle', async t => {
  const f = await fixture(t), schema = `rc_legacy_${randomUUID().replaceAll('-', '')}`;
  assert.ok(f.config.databaseUrl); const url = new URL(f.config.databaseUrl);
  const sourceSchema = new URL(f.config.databaseUrl).searchParams.get('options')?.match(/search_path=([a-z0-9_]+)/)?.[1]; assert.ok(sourceSchema);
  await f.db.exec(`CREATE SCHEMA "${schema}"`); url.searchParams.set('options', `-c search_path=${schema}`);
  const legacy = postgresConnection(url.href);
  f.cleanup.push(async () => { await legacy.close(); await f.db.exec(`DROP SCHEMA "${schema}" CASCADE`); });
  await legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const migration of migrations.filter(item => item.version <= 14)) {
    await legacy.exec(migration.sql);
    await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)')
      .run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'));
  }
  for (const table of ['users', 'durable_operations', 'stripe_billing_reference', 'stripe_owned_customers', 'stripe_checkout_attempts', 'stripe_owned_subscription_ledger']) {
    const columns = (await legacy.prepare(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=? AND table_name=? ORDER BY ordinal_position`).all(schema, table)).map(row => String(row.column_name));
    assert.ok(columns.every(column => /^[a-z_][a-z0-9_]*$/.test(column)));
    await legacy.exec(`INSERT INTO "${schema}".${table}(${columns.join(',')}) SELECT ${columns.join(',')} FROM "${sourceSchema}".${table}`);
  }
  const columns = 'id,policy_version,customer_ref,subscription_ref,attempt_id,auth_epoch,operation_id,state,created_at,confirmed_at,result';
  await legacy.exec(`INSERT INTO stripe_subscription_cancellations(${columns}) SELECT ${columns} FROM "${sourceSchema}".stripe_subscription_cancellations`);
  const row = await legacy.prepare(`SELECT ${columns} FROM stripe_subscription_cancellations`).get(),
    operation = await legacy.prepare("SELECT payload,receipt FROM durable_operations WHERE kind='billing.subscription.cancel'").get();
  await migrateDatabase(legacy); await migrateDatabase(legacy); await assertDatabaseVersion(legacy);
  assert.deepEqual(await legacy.prepare(`SELECT ${columns} FROM stripe_subscription_cancellations`).get(), row);
  assert.deepEqual(await legacy.prepare("SELECT payload,receipt FROM durable_operations WHERE kind='billing.subscription.cancel'").get(), operation);
  assert.deepEqual(await legacy.prepare('SELECT cycle,previous_resumption_id,policy_version FROM stripe_subscription_cancellations').get(),
    { cycle: '0', previous_resumption_id: null, policy_version: sandboxRenewalAuthority });
});

test('compiled maintained reconciliation claims new renewal work and publishes canonical state without development loaders', async t => {
  const f = await fixture(t); await reserve(f);
  const script = `import { runBillingCommand } from './dist-server/billing/cli.js'; import Stripe from 'stripe';
    const client=new Stripe(process.env.STRIPE_TEST_SECRET_KEY,{host:'127.0.0.1',port:${f.port},protocol:'http',
      apiVersion:'${stripeApiVersion}',timeout:1000,maxNetworkRetries:0}); await runBillingCommand('reconcile',client);`;
  assert.ok(f.config.databaseUrl);
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(),
    env: { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: f.config.databaseUrl,
      ...authJsEnvironment(f.origin), ...sandboxSettings }, timeout: 30000 });
  assert.equal((await resumption(f))?.state, 'confirmed');
  assert.equal((await f.view(f.browser)).ledger?.subscriptions[0].nonrenewing, false);
  assert.equal((await f.view(f.browser)).ledger?.stale, false); assert.equal(posts(f).length, 1);
});
