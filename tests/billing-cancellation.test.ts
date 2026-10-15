import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authJsEnvironment, openBillingFixture, sandboxSettings } from './fixtures/billing';
import { sandboxRenewalAuthority, sandboxServicePolicy } from '../shared/billing-ledger';
import { TerminalJobFailure, LostJobClaim } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';
import { BillingNotifications } from '../server/billing';
import { stripeApiVersion } from '../server/billing/schema';
import { problems } from '../shared/catalog';

async function fixture(t: TestContext, service = false) {
  const f = await openBillingFixture(t, service ? { STRIPE_TEST_ACCESS_POLICY: sandboxServicePolicy } : {}), { browser, owner } = await f.login();
  const attempt = await f.reserve(browser); await f.complete('billing.customer'); await f.complete('billing.checkout');
  const facts = await f.settleCheckout();
  assert.equal((await browser.request(`/api/billing/checkouts/${attempt.id}/refresh`, {})).status, 200);
  await f.complete('billing.checkout.refresh');
  await f.complete('billing.customer.snapshot'); await f.complete('billing.customer.snapshot');
  const sub = (await f.view(browser)).ledger?.subscriptions[0]; assert.ok(sub);
  const url = `/api/billing/subscriptions/${sub.id}/cancel`;
  return { ...f, browser, owner, facts, url, sub };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function reserve(f: Fixture) {
  const response = await f.browser.request(f.url, {});
  assert.equal(response.status, 202, await response.clone().text());
  const value: { id: string; accepted: boolean } = await response.json(); assert.equal(value.accepted, true);
  return value;
}
async function cancellation(f: Fixture) { return (await f.view(f.browser)).ledger?.subscriptions[0].cancellation; }
function posts(f: Fixture) { return f.requests.filter(request => request.method === 'POST' && request.path.startsWith('/v1/subscriptions/')); }

test('owned cancellation admission is fresh, CSRF-protected, strict, replica-deduplicated and never accepts a provider target', async t => {
  const f = await fixture(t);
  assert.equal((await f.browser.request(f.url, {}, 'POST', { 'X-CSRF-Token': 'wrong' })).status, 403);
  for (const input of [{ subscription: f.facts.sub.id }, { refund: true }, { immediate: true }, { cancel_at_period_end: false }, { reason: 'client authority' }]) {
    assert.equal((await f.browser.request(f.url, input)).status, 400);
  }
  assert.equal((await f.browser.request(`/api/billing/subscriptions/${f.facts.sub.id}/cancel`, {})).status, 400);
  assert.equal((await f.browser.request(`/api/billing/subscriptions/${randomUUID()}/cancel`, {})).status, 404);
  const stranger = await f.login(undefined, 'auth0|cancellation-stranger');
  assert.equal((await stranger.browser.request(f.url, {})).status, 404);
  const replica = await f.replica(), browser = replica.browser();
  for (const [key, value] of f.browser.cookies) browser.cookies.set(key, value);
  await browser.bootstrap();
  const [first, second] = await Promise.all([reserve(f), browser.request(f.url, {})]);
  assert.equal(second.status, 202); assert.equal((await second.json()).id, first.id);
  const parallel = await Promise.all([reserve(f), browser.request(f.url, {})]);
  assert.equal(parallel[0].id, first.id); assert.equal((await parallel[1].json()).id, first.id);
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.subscription.cancel'").get())?.count, 1);
  assert.equal((await cancellation(f))?.state, 'queued'); assert.equal(posts(f).length, 0);
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=authenticated_at-660000 WHERE token IN (SELECT token FROM sessions WHERE user_id=?)').run(f.owner);
  assert.equal((await f.browser.request(f.url, {})).status, 403);
});

test('canonical stop-renewal confirmation and dirty ledger handoff preserve paid grants, audits, money and owned work', async t => {
  const f = await fixture(t, true), grant = await f.db.prepare('SELECT * FROM entitlement_grants').get(),
    events = await f.db.prepare('SELECT * FROM entitlement_events').all(), funding = structuredClone(f.facts.invoice);
  const problem = problems.find(problem => problem.premium); assert.ok(problem);
  assert.equal((await f.browser.request('/api/mocks', { problemId: problem.id, company: 'Meta', level: 'Senior', length: 3 })).status, 200);
  const archive = (await f.browser.bootstrap()).state.mocks;
  await reserve(f); const readsBefore = f.requests.length, result = await f.complete('billing.subscription.cancel');
  assert.equal(f.requests.length - readsBefore, 5, 'Cancellation uses its exact bounded account/customer/subscription/write/final-read contract.');
  assert.equal(result.receipt?.authority, sandboxRenewalAuthority); assert.equal(result.receipt?.result, 'nonrenewing');
  assert.equal((await cancellation(f))?.state, 'confirmed'); assert.equal((await f.view(f.browser)).ledger?.stale, true);
  await f.complete('billing.customer.snapshot');
  assert.equal((await f.view(f.browser)).ledger?.subscriptions[0].nonrenewing, true);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_grants').get(), grant);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_events').all(), events); assert.deepEqual(f.facts.invoice, funding);
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'pro');
  assert.deepEqual((await f.browser.bootstrap()).state.mocks, archive);
  assert.equal((await f.browser.request(`/api/content/problems/${problem.id}`)).status, 200);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_revocations').get())?.count, 0);
  assert.deepEqual(posts(f).map(request => ({ body: request.body, key: request.key })), [{
    body: { cancel_at_period_end: 'true', proration_behavior: 'none' }, key: result.id,
  }]);
  const duplicate = await reserve(f); assert.equal(duplicate.id, result.receipt?.cancellationId);
  assert.equal(posts(f).length, 1);
  for (const secret of ['cus_Synthetic', 'sub_Synthetic', 'price_Synthetic', 'studio_customer_ref', 'authEpoch']) {
    assert.ok(!JSON.stringify(await f.view(f.browser)).includes(secret));
  }
});

test('default observation-only mode can stop test renewal without grants; withdrawn offers do not withdraw cancellation', async t => {
  const f = await fixture(t); assert.ok(f.config.billing);
  const shutdown = new AbortController(), changed = await BillingNotifications.open(f.db, { ...f.config.billing, offers: null }, shutdown.signal, true, f.client, f.origin);
  f.cleanup.push(async () => { shutdown.abort(); await changed.close(); }); assert.ok(changed.checkout);
  const result = await changed.checkout.cancelRenewal(f.owner, f.sub.id); assert.ok(result.accepted);
  const claim = await changed.jobs.claim('billing.subscription.cancel'); assert.ok(claim); await changed.runClaim(claim);
  await f.complete('billing.customer.snapshot');
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'free');
  assert.equal((await f.view(f.browser)).accessAuthority, 'none');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_invoice_service_evidence').get())?.count, 0);
  assert.equal(posts(f).length, 1);
});

test('already nonrenewing or ended owned subscriptions confirm read-only without another provider mutation', async t => {
  for (const ended of [false, true]) {
    const f = await fixture(t); await reserve(f);
    if (ended) f.facts.sub.status = 'canceled'; else f.facts.sub.cancel_at_period_end = true;
    const result = await f.complete('billing.subscription.cancel');
    assert.equal(result.receipt?.result, ended ? 'ended' : 'nonrenewing'); assert.equal(posts(f).length, 0);
  }
});

test('a missing or dirty/stale canonical ledger holds new cancellation instead of borrowing a cached subscription', async t => {
  const f = await fixture(t);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  assert.equal((await f.browser.request(f.url, {})).status, 409); assert.equal(posts(f).length, 0);
  await f.complete('billing.customer.snapshot');
  await f.db.prepare("UPDATE stripe_customer_ledger_state SET observed_at=clock_timestamp()-interval '5 minutes'").run();
  assert.equal((await f.browser.request(f.url, {})).status, 409);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_subscription_cancellations').get())?.count, 0);
});

test('foreign account/customer/subscription/quote, unbounded items, schedules and pending changes fail before stop-renewal POST', async t => {
  const f = await fixture(t); await reserve(f);
  const claim = await f.worker.jobs.claim('billing.subscription.cancel'); assert.ok(claim);
  const original = structuredClone(f.facts.sub), customer = [...f.customers.values()][0], saved = structuredClone(customer);
  f.account('acct_Foreign'); await assert.rejects(f.worker.runClaim(claim)); f.account(sandboxSettings.STRIPE_TEST_ACCOUNT_ID);
  for (const change of [{ livemode: true }, { deleted: true }, { metadata: { studio_customer_ref: randomUUID() } }]) {
    Object.assign(customer, change); await assert.rejects(f.worker.runClaim(claim));
    for (const key of Object.keys(customer)) delete customer[key]; Object.assign(customer, saved);
  }
  for (const change of [{ id: 'sub_Foreign' }, { customer: 'cus_Foreign' }, { livemode: true }, { metadata: {} },
    { schedule: 'sub_sched_External' }, { pending_update: { expires_at: 1 } }, { cancel_at: 1 },
    { items: { has_more: true, data: original.items.data } },
    { items: { has_more: false, data: [{ ...original.items.data[0], price: { id: 'price_Foreign' } }] } },
    { status: 'trialing' }]) {
    Object.assign(f.facts.sub, change); await assert.rejects(f.worker.runClaim(claim)); Object.assign(f.facts.sub, original);
  }
  assert.equal(posts(f).length, 0); assert.equal((await cancellation(f))?.state, 'queued');
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('unknown cancellation after provider success recovers read-only even after the 20-hour mutation window', async t => {
  const f = await fixture(t); await reserve(f);
  const claim = await f.worker.jobs.claim('billing.subscription.cancel'); assert.ok(claim);
  await f.db.executeSql(`CREATE FUNCTION fail_cancellation_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN RAISE EXCEPTION 'synthetic lost cancellation publication'; END $body$;
    CREATE TRIGGER fail_cancellation_publication BEFORE UPDATE ON stripe_subscription_cancellations FOR EACH ROW EXECUTE FUNCTION fail_cancellation_publication();`);
  await assert.rejects(f.worker.runClaim(claim), /synthetic lost cancellation publication/);
  assert.equal(f.facts.sub.cancel_at_period_end, true); assert.equal((await cancellation(f))?.state, 'queued');
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  await f.db.executeSql('DROP TRIGGER fail_cancellation_publication ON stripe_subscription_cancellations');
  await f.db.prepare("UPDATE durable_operations SET created_at=clock_timestamp()-interval '21 hours' WHERE id=?").run(claim.data.operationId);
  await f.worker.runClaim(claim); assert.equal((await cancellation(f))?.state, 'confirmed'); assert.equal(posts(f).length, 1);
});

test('expired mutation windows, provider outages and final flag reversals remain incomplete rather than confirming success', async t => {
  const f = await fixture(t); await reserve(f);
  const claim = await f.worker.jobs.claim('billing.subscription.cancel'); assert.ok(claim);
  await f.db.prepare("UPDATE durable_operations SET created_at=clock_timestamp()-interval '21 hours' WHERE id=?").run(claim.data.operationId);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 0);
  await f.db.prepare('UPDATE durable_operations SET created_at=clock_timestamp() WHERE id=?').run(claim.data.operationId);
  const path = `/v1/subscriptions/${f.facts.sub.id}`; f.outage(path);
  await assert.rejects(f.worker.runClaim(claim)); f.outage('');
  let reads = 0; f.barrier(async (requested, method) => { if (requested === path && method === 'GET' && ++reads === 2) f.facts.sub.cancel_at_period_end = false; });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); f.barrier();
  assert.equal((await cancellation(f))?.state, 'queued'); assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal(posts(f).length, 1);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure, 'Cached POST confirmation cannot override the current canonical flag.');
});

test('security changes immediately before provider mutation deny writes; changes during confirmation fence local publication', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.cancel'); assert.ok(claim);
  const path = `/v1/subscriptions/${f.facts.sub.id}`;
  f.barrier(async (requested, method) => { if (requested === path && method === 'GET') {
    f.barrier(); await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
  } });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 0);
  await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch-1 WHERE user_id=?').run(f.owner);
  let reads = 0;
  f.barrier(async (requested, method) => { if (requested === path && method === 'GET' && ++reads === 2) {
    f.barrier(); await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
  } });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal(posts(f).length, 1); assert.equal((await f.db.prepare('SELECT state FROM stripe_subscription_cancellations').get())?.state, 'queued');
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('a moved local customer mapping or captured Price cannot authorize the earlier prepared provider target', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.cancel'); assert.ok(claim);
  f.barrier(async (requested, method) => { if (requested === `/v1/subscriptions/${f.facts.sub.id}` && method === 'GET') {
    f.barrier(); await f.db.prepare("UPDATE stripe_owned_customers SET customer_id='cus_MovedMapping' WHERE user_id=?").run(f.owner);
  } });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 0);
  const customerId = f.facts.sub.customer; assert.ok(typeof customerId === 'string');
  await f.db.prepare('UPDATE stripe_owned_customers SET customer_id=? WHERE user_id=?').run(customerId, f.owner);
  await f.db.prepare("UPDATE stripe_checkout_attempts SET price_id='price_MovedQuote'").run();
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 0);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('the write heartbeat cannot run after the final security fence and authorize a prepared stale mutation', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.cancel'); assert.ok(claim);
  const heartbeat = f.worker.jobs.heartbeat.bind(f.worker.jobs); let calls = 0;
  f.worker.jobs.heartbeat = async (current, signal) => {
    await heartbeat(current, signal);
    if (++calls === 4) await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
  };
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal(calls, 4); assert.equal(posts(f).length, 0);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('admission security changes inside actual cancellation SQL roll the intent and both queue surfaces back', async t => {
  const f = await fixture(t);
  await f.db.executeSql(`CREATE SEQUENCE cancellation_admission_witness;
    CREATE FUNCTION change_cancellation_admission() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('cancellation_admission_witness');
      UPDATE managed_accounts SET session_epoch=session_epoch+1; RETURN NEW; END $body$;
    CREATE TRIGGER change_cancellation_admission AFTER INSERT ON stripe_subscription_cancellations FOR EACH ROW EXECUTE FUNCTION change_cancellation_admission();`);
  assert.equal((await f.browser.request(f.url, {})).status, 403);
  assert.equal((await f.db.prepare('SELECT is_called FROM cancellation_admission_witness').get())?.is_called, true);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_subscription_cancellations').get())?.count, 0);
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.subscription.cancel'").get())?.count, 0);
  assert.equal(await f.worker.jobs.claim('billing.subscription.cancel'), undefined); assert.equal(posts(f).length, 0);
});

test('native lease expiry after actual confirmation SQL rolls intent, ledger generation and completion back after external success', async t => {
  const f = await fixture(t); await reserve(f); const initial = await f.db.prepare('SELECT requested_revision FROM stripe_customer_ledger_state').get();
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  const queued = await f.db.prepare("SELECT job_id FROM durable_operations WHERE kind='billing.subscription.cancel'").get(); assert.ok(queued);
  await boss.update('billing-subscription-cancel', undefined, { id: String(queued.job_id), expireInSeconds: 2 });
  const claim = await f.worker.jobs.claim('billing.subscription.cancel'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE cancellation_publication_witness;
    CREATE FUNCTION expire_cancellation_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('cancellation_publication_witness'); PERFORM pg_sleep(2.1); RETURN NEW; END $body$;
    CREATE TRIGGER expire_cancellation_publication AFTER UPDATE ON stripe_subscription_cancellations FOR EACH ROW EXECUTE FUNCTION expire_cancellation_publication();`);
  await assert.rejects(f.worker.runClaim(claim), LostJobClaim);
  assert.equal((await f.db.prepare('SELECT is_called FROM cancellation_publication_witness').get())?.is_called, true);
  assert.deepEqual(await f.db.prepare('SELECT requested_revision FROM stripe_customer_ledger_state').get(), initial);
  assert.equal((await cancellation(f))?.state, 'queued'); assert.equal(f.facts.sub.cancel_at_period_end, true);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('deletion during canonical confirmation keeps a retained unowned customer and never completes or retries its provider mutation', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.subscription.cancel'); assert.ok(claim);
  let reads = 0; f.barrier(async (path, method) => { if (path === `/v1/subscriptions/${f.facts.sub.id}` && method === 'GET' && ++reads === 2) {
    f.barrier(); await f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);
  } });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.deepEqual(await f.db.prepare('SELECT state,user_id FROM stripe_owned_customers').get(), { state: 'retired', user_id: null });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 1);
});

test('changed current renewal flags after an earlier confirmation require visible operator review, never silently resume or replace its intent', async t => {
  const f = await fixture(t); const request = await reserve(f); await f.complete('billing.subscription.cancel'); await f.complete('billing.customer.snapshot');
  f.facts.sub.cancel_at_period_end = false;
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202); await f.complete('billing.customer.snapshot');
  assert.equal((await f.browser.request(f.url, {})).status, 409);
  assert.equal((await cancellation(f))?.id, request.id); assert.equal(posts(f).length, 1);
});

test('compiled maintained reconciliation claims cancellation and publishes owned canonical flags without development loaders', async t => {
  const f = await fixture(t); await reserve(f);
  const code = `import Stripe from 'stripe'; import { runBillingCommand } from './dist-server/billing/cli.js';
    const client = new Stripe(process.env.STRIPE_TEST_SECRET_KEY, { host: '127.0.0.1', port: ${f.port}, protocol: 'http',
      apiVersion: '${stripeApiVersion}', maxNetworkRetries: 0, timeout: 1000 }); await runBillingCommand('reconcile', client);`;
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: f.config.databaseUrl!,
    ...authJsEnvironment(f.origin), ...sandboxSettings };
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000 });
  assert.equal(JSON.parse(result.stdout).event, 'billing.sandbox.reconciled');
  assert.equal((await cancellation(f))?.state, 'confirmed'); assert.equal((await f.view(f.browser)).ledger?.subscriptions[0].nonrenewing, true);
});
