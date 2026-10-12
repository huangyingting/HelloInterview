import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { openBillingFixture, sandboxSettings } from './fixtures/billing';
import { stripeApiVersion } from '../server/billing/schema';
import { canonicalOriginSchema, hostedCheckoutUrl } from '../server/billing/checkout-schema';
import { TerminalJobFailure, LostJobClaim, type JobClaim } from '../server/jobs';
import type { ClaimData } from '../server/jobs/schema';
import { createBoss } from '../server/jobs/queue';
import { Entitlements } from '../server/entitlements';
import { BillingNotifications } from '../server/billing';

function barrier() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve() { assert.ok(resolve); resolve(); } };
}
test('owned HTTPS replica admission is fresh, CSRF-protected, strict and duplicate-safe; customer and hosted session are server-correlated without grants', async t => {
  const f = await openBillingFixture(t), { browser, owner } = await f.login();
  assert.equal((await f.view(browser)).checkout, null);
  assert.equal((await f.browser().request('/api/billing')).status, 401);
  assert.equal((await browser.request('/api/billing/checkouts', { key: randomUUID(), offer: 'pro_monthly' }, 'POST', { 'X-CSRF-Token': 'wrong' })).status, 403);
  for (const change of [{ price: 'price_ClientAuthority' }, { customer: 'cus_ClientAuthority' }, { amount: 1 }, { return_url: 'https://foreign.fixture' }, { metadata: { owner } }]) {
    assert.equal((await browser.request('/api/billing/checkouts', { key: randomUUID(), offer: 'pro_monthly', ...change })).status, 400);
  }
  const replica = await f.replica(), otherBrowser = replica.browser();
  for (const [key, value] of browser.cookies) otherBrowser.cookies.set(key, value);
  await otherBrowser.bootstrap();
  const key = randomUUID(), replies = await Promise.all([f.reserve(browser, 'pro_monthly', key), f.reserve(otherBrowser, 'pro_monthly', key)]);
  assert.equal(replies[0].id, replies[1].id);
  assert.equal((await browser.request('/api/billing/checkouts', { key, offer: 'pro_annual' })).status, 409);
  assert.equal((await browser.request('/api/billing/checkouts', { key: randomUUID(), offer: 'pro_monthly' })).status, 409);
  assert.equal(f.requests.length, 0);
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  const view = await f.view(browser);
  assert.equal(view.checkout?.state, 'open'); assert.equal(view.checkout?.requestKey, key);
  assert.deepEqual(view.checkout?.quote, { currency: 'usd', unitAmount: 1900 });
  assert.equal(view.accessAuthority, 'none');
  assert.ok(!JSON.stringify(view).includes('checkout.stripe.com')); assert.ok(!JSON.stringify(view).includes('cus_Synthetic'));
  const opened = await browser.request(`/api/billing/checkouts/${replies[0].id}/open`, {});
  assert.equal(opened.status, 200); assert.match((await opened.json()).url, /#opaque-fixture-fragment$/);
  const stranger = await f.login(f.browser(), 'auth0|checkout-stranger');
  assert.equal((await stranger.browser.request(`/api/billing/checkouts/${replies[0].id}/open`, {})).status, 404);
  assert.equal((await stranger.browser.request(`/api/billing/checkouts/${replies[0].id}/refresh`, {})).status, 404);
  assert.equal((await browser.bootstrap()).capabilities.commerce, 'disabled');
  assert.equal((await browser.bootstrap()).capabilities.access?.state, 'free');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.deepEqual(f.requests.filter(request => request.method === 'POST').map(request => request.path), ['/v1/customers', '/v1/checkout/sessions']);
  assert.ok(f.requests.every(request => request.version === stripeApiVersion));
  const stored = JSON.stringify(await f.db.prepare('SELECT payload,receipt FROM durable_operations').all());
  assert.ok(!stored.includes('owner@example.invalid')); assert.ok(!stored.includes('opaque-fixture-fragment'));
});

test('stale proof and unverified accounts cannot reserve customer intents; shared replica billing admission is bounded', async t => {
  const f = await openBillingFixture(t), { browser, owner } = await f.login();
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=authenticated_at-660000 WHERE token IN (SELECT token FROM sessions WHERE user_id=?)').run(owner);
  assert.equal((await browser.request('/api/billing/checkouts', { key: randomUUID(), offer: 'pro_monthly' })).status, 403);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_owned_customers').get())?.count, 0);
  const fresh = await f.login(f.browser());
  const intent = await f.reserve(fresh.browser), replica = await f.replica(), second = replica.browser();
  for (const [key, value] of fresh.browser.cookies) second.cookies.set(key, value);
  await second.bootstrap();
  const responses = await Promise.all(Array.from({ length: 31 }, (_, index) => (index % 2 ? second : fresh.browser)
    .request('/api/billing/checkouts', { offer: intent.offer, key: intent.key })));
  assert.ok(responses.some(response => response.status === 429));
  assert.ok(responses.filter(response => response.status === 429).every(response => Number(response.headers.get('Retry-After')) > 0));
  await f.db.prepare("UPDATE managed_accounts SET status='pending-verification',contact_verified=0 WHERE user_id=?").run(owner);
  assert.equal((await browser.request('/api/billing')).status, 403);
  assert.equal(f.requests.length, 0);
});

test('lost customer publication recovers the original stable key; beyond 20 hours recovery is read-only and absent or ambiguous matches hold', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.reserve(browser);
  const claim = await f.worker.jobs.claim('billing.customer'); assert.ok(claim);
  await f.db.executeSql(`CREATE FUNCTION fail_customer_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.state='mapped' THEN RAISE EXCEPTION 'synthetic lost customer publication'; END IF; RETURN NEW; END $body$;
    CREATE TRIGGER fail_customer_publication BEFORE UPDATE ON stripe_owned_customers FOR EACH ROW EXECUTE FUNCTION fail_customer_publication();`);
  await assert.rejects(f.worker.runClaim(claim), /synthetic lost customer publication/);
  await assert.rejects(f.worker.runClaim(claim), /synthetic lost customer publication/);
  assert.equal(f.customers.size, 1);
  assert.deepEqual(f.requests.filter(request => request.method === 'POST').map(request => request.key), [claim.data.operationId, claim.data.operationId]);
  assert.equal((await f.db.prepare('SELECT state FROM stripe_owned_customers').get())?.state, 'reserved');
  await f.db.executeSql('DROP TRIGGER fail_customer_publication ON stripe_owned_customers');
  await f.db.prepare("UPDATE durable_operations SET created_at=clock_timestamp()-interval '20 hours' WHERE id=?").run(claim.data.operationId);
  const canonical = [...f.customers.values()][0];
  f.customers.clear();
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  f.customers.set(String(canonical.id), canonical);
  f.pagination('/v1/customers/search');
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  f.pagination('');
  await f.worker.runClaim(claim);
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 2);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt?.authority, 'sandbox-correlation-only');
  await f.complete('billing.checkout');
});

test('unknown checkout outcome recovers its completed original before inspecting subscriptions, even after replay window and price deactivation', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  const intent = await f.reserve(browser); await f.complete('billing.customer');
  const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  await f.db.executeSql(`CREATE FUNCTION fail_checkout_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN RAISE EXCEPTION 'synthetic lost checkout publication'; END $body$;
    CREATE TRIGGER fail_checkout_publication BEFORE UPDATE ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION fail_checkout_publication();`);
  await assert.rejects(f.worker.runClaim(claim), /synthetic lost checkout publication/);
  assert.equal(f.sessions.size, 1); assert.equal((await f.view(browser)).checkout?.state, 'queued');
  await f.db.executeSql('DROP TRIGGER fail_checkout_publication ON stripe_checkout_attempts');
  const session = [...f.sessions.values()][0];
  Object.assign(session, { status: 'complete', payment_status: 'paid', subscription: 'sub_SyntheticCompleted', url: null });
  f.subscriptions.push({ id: 'sub_SyntheticCompleted', object: 'subscription', customer: session.customer, livemode: false, status: 'active' });
  f.prices.get('price_SyntheticMonthly')!.active = false; f.product.active = false;
  await f.db.prepare("UPDATE durable_operations SET created_at=clock_timestamp()-interval '21 hours' WHERE id=?").run(claim.data.operationId);
  await f.worker.runClaim(claim);
  assert.equal((await f.view(browser)).checkout?.state, 'complete');
  assert.equal((await browser.request(`/api/billing/checkouts/${intent.id}/open`, {})).status, 409);
  assert.equal((await browser.request('/api/billing/checkouts', { key: randomUUID(), offer: 'pro_annual' })).status, 409);
  assert.equal(f.requests.filter(request => request.path === '/v1/checkout/sessions' && request.method === 'POST').length, 1);
  assert.equal(f.requests.filter(request => request.path === '/v1/subscriptions').length, 1);
  assert.equal((await browser.bootstrap()).capabilities.access?.state, 'free');
});

test('canonical validation refuses foreign/deleted customers, invalid offers, paginated or existing subscriptions and never posts an unapproved session', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.reserve(browser); await f.complete('billing.customer');
  const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  const customer = [...f.customers.values()][0], savedCustomer = structuredClone(customer);
  for (const change of [{ livemode: true }, { id: 'cus_Foreign' }, { deleted: true, livemode: undefined }, { metadata: { studio_customer_ref: randomUUID() } }]) {
    Object.assign(customer, change); await assert.rejects(f.worker.runClaim(claim));
    for (const key of Object.keys(customer)) delete customer[key];
    Object.assign(customer, savedCustomer);
  }
  const price = f.prices.get('price_SyntheticMonthly')! , savedPrice = structuredClone(price);
  for (const change of [{ livemode: true }, { active: false }, { currency: 'eur' }, { unit_amount: 0 }, { billing_scheme: 'tiered' },
    { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } }, { recurring: { interval: 'month', interval_count: 2, usage_type: 'metered' } }]) {
    Object.assign(price, change); await assert.rejects(f.worker.runClaim(claim)); Object.assign(price, savedPrice);
  }
  f.pagination('/v1/checkout/sessions'); await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  f.pagination('/v1/subscriptions'); await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  f.pagination('');
  f.subscriptions.push({ id: 'sub_SyntheticExisting', object: 'subscription', customer: customer.id, livemode: false, status: 'active' });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal(f.requests.filter(request => request.path === '/v1/checkout/sessions' && request.method === 'POST').length, 0);
  f.subscriptions[0].status = 'canceled';
  await f.worker.runClaim(claim);
  assert.equal(f.sessions.size, 1);
});

test('canonical refresh is deduplicated, never reopens terminal sessions and does not replace independent access grants', async t => {
  const f = await openBillingFixture(t), { browser, owner } = await f.login();
  const entitlements = new Entitlements(f.db), grant = { owner, source: { kind: 'engineering' as const, key: randomUUID() }, policy: 'pro-v1' as const,
    startsAt: Date.now() - 1000, endsAt: Date.now() + 3600000, evidence: { actor: 'billing-fixture', reason: 'An independent licensed source survives sandbox checkout.' } };
  await entitlements.issue(grant);
  const intent = await f.reserve(browser); await f.complete('billing.customer'); await f.complete('billing.checkout');
  const session = [...f.sessions.values()][0];
  Object.assign(session, { status: 'complete', payment_status: 'paid', subscription: 'sub_SyntheticRefresh', url: null });
  for (let index = 0; index < 2; index++) assert.equal((await browser.request(`/api/billing/checkouts/${intent.id}/refresh`, {})).status, 200);
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.checkout.refresh'").get())?.count, 1);
  await f.complete('billing.checkout.refresh');
  assert.equal((await f.view(browser)).checkout?.state, 'complete');
  Object.assign(session, { status: 'open', payment_status: 'unpaid', url: `https://checkout.stripe.com/c/pay/${session.id}` });
  assert.equal((await browser.request(`/api/billing/checkouts/${intent.id}/refresh`, {})).status, 200);
  const claim = await f.worker.jobs.claim('billing.checkout.refresh'); assert.ok(claim);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.view(browser)).checkout?.state, 'complete');
  assert.equal((await entitlements.view(owner)).state, 'pro');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 1);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_revocations').get())?.count, 0);
});

test('security changes immediately before provider POST deny mutation, and deletion during provider preparation leaves terminal unowned tombstones', async t => {
  const f = await openBillingFixture(t), { browser, owner } = await f.login();
  await f.reserve(browser); await f.complete('billing.customer');
  const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  f.barrier(async path => { if (path === '/v1/subscriptions') { f.barrier(); await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(owner); } });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal(f.sessions.size, 0);
  await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch-1 WHERE user_id=?').run(owner);
  f.barrier(async path => { if (path.startsWith('/v1/checkout/sessions/')) { f.barrier(); await f.db.prepare('DELETE FROM users WHERE id=?').run(owner); } });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal(f.sessions.size, 1);
  assert.deepEqual(await f.db.prepare('SELECT state,user_id FROM stripe_owned_customers').get(), { state: 'retired', user_id: null });
  assert.deepEqual(await f.db.prepare('SELECT state,hosted_url FROM stripe_checkout_attempts').get(), { state: 'retired', hosted_url: null });
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).completedAt, null);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal(f.sessions.size, 1);
});

test('an actual security-changing publication trigger rolls back the mapped customer, checkout outbox and completion together', async t => {
  const f = await openBillingFixture(t), { browser, owner } = await f.login();
  await f.reserve(browser);
  const claim = await f.worker.jobs.claim('billing.customer'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE customer_publication_witness;
    CREATE FUNCTION change_customer_security() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('customer_publication_witness'); UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=NEW.user_id; RETURN NEW; END $body$;
    CREATE TRIGGER change_customer_security AFTER UPDATE ON stripe_owned_customers FOR EACH ROW EXECUTE FUNCTION change_customer_security();`);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.db.prepare('SELECT is_called FROM customer_publication_witness').get())?.is_called, true);
  assert.equal((await f.db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?').get(owner))?.session_epoch, 0);
  assert.equal((await f.db.prepare('SELECT state,customer_id FROM stripe_owned_customers').get())?.state, 'reserved');
  assert.equal((await f.db.prepare('SELECT state,operation_id FROM stripe_checkout_attempts').get())?.state, 'waiting-customer');
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.checkout'").get())?.count, 0);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('fresh admission revoked inside actual reservation SQL rolls back the binding, customer, checkout and both queue surfaces', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.db.executeSql(`CREATE SEQUENCE checkout_admission_witness;
    CREATE FUNCTION change_checkout_admission() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('checkout_admission_witness'); UPDATE managed_accounts SET session_epoch=session_epoch+1; RETURN NEW; END $body$;
    CREATE TRIGGER change_checkout_admission AFTER INSERT ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION change_checkout_admission();`);
  assert.equal((await browser.request('/api/billing/checkouts', { key: randomUUID(), offer: 'pro_monthly' })).status, 403);
  assert.equal((await f.db.prepare('SELECT is_called FROM checkout_admission_witness').get())?.is_called, true);
  for (const table of ['stripe_billing_reference', 'stripe_owned_customers', 'stripe_checkout_attempts', 'durable_operations']) {
    assert.equal((await f.db.prepare(`SELECT count(*)::integer AS count FROM ${table}`).get())?.count, 0);
  }
  assert.equal(await f.worker.jobs.claim('billing.customer'), undefined);
  assert.equal(f.requests.length, 0);
});

test('claim expiry inside actual checkout publication rolls back private redirects and completion after provider success', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.reserve(browser); await f.complete('billing.customer');
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  const queued = await f.db.prepare("SELECT job_id FROM durable_operations WHERE kind='billing.checkout'").get(); assert.ok(queued);
  await boss.update('billing-checkout', undefined, { id: String(queued.job_id), expireInSeconds: 2 });
  const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  assert.equal(claim.expireInSeconds, 2);
  await f.db.executeSql(`CREATE SEQUENCE checkout_publication_witness;
    CREATE FUNCTION expire_checkout_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('checkout_publication_witness'); PERFORM pg_sleep(2.1); RETURN NEW; END $body$;
    CREATE TRIGGER expire_checkout_publication AFTER UPDATE ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION expire_checkout_publication();`);
  await assert.rejects(f.worker.runClaim(claim), LostJobClaim);
  assert.equal((await f.db.prepare('SELECT is_called FROM checkout_publication_witness').get())?.is_called, true);
  assert.deepEqual(await f.db.prepare('SELECT state,session_id,hosted_url FROM stripe_checkout_attempts').get(), { state: 'queued', session_id: null, hosted_url: null });
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal(f.sessions.size, 1);
});

test('captured checkout intents survive offer withdrawal and origin changes with immutable provider parameters', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.reserve(browser); await f.complete('billing.customer');
  assert.ok(f.config.billing);
  const shutdown = new AbortController(), changed = await BillingNotifications.open(f.db, { ...f.config.billing, offers: null }, shutdown.signal, true, f.client, 'https://new-studio.fixture');
  f.cleanup.push(() => changed.close());
  const claim = await changed.jobs.claim('billing.checkout'); assert.ok(claim); await changed.runClaim(claim);
  assert.ok(changed.checkout);
  assert.equal((await changed.checkout.view((await f.login()).owner)).enabled, false);
  const session = [...f.sessions.values()][0];
  assert.ok(String(session.success_url).startsWith(f.origin));
  assert.ok(!String(session.success_url).includes('new-studio.fixture'));
  const post = f.requests.find(request => request.path === '/v1/checkout/sessions' && request.method === 'POST'); assert.ok(post);
  assert.equal(post.key, claim.data.operationId);
});

test('canonical session mismatches remain unresolved instead of publishing a redirect, payment hint or grant', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.reserve(browser); await f.complete('billing.customer');
  const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  await f.db.executeSql(`CREATE FUNCTION hold_session_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN RAISE EXCEPTION 'synthetic held publication'; END $body$;
    CREATE TRIGGER hold_session_publication BEFORE UPDATE ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION hold_session_publication();`);
  await assert.rejects(f.worker.runClaim(claim), /synthetic held publication/);
  await f.db.executeSql('DROP TRIGGER hold_session_publication ON stripe_checkout_attempts');
  const session = [...f.sessions.values()][0], original = structuredClone(session);
  for (const change of [{ customer: 'cus_Foreign' }, { livemode: true }, { mode: 'payment' }, { ui_mode: 'embedded_page' },
    { client_reference_id: randomUUID() }, { metadata: { studio_customer_ref: randomUUID() } }, { expires_at: 1 },
    { success_url: 'https://foreign.fixture/billing' }, { url: 'https://foreign.fixture/c/pay/test' },
    { line_items: { has_more: false, data: [{ quantity: 1, currency: 'usd', price: { id: 'price_Foreign' } }] } },
    { line_items: { has_more: true, data: [] } }, { line_items: { has_more: false, data: [{ quantity: 2, currency: 'usd', price: { id: 'price_SyntheticMonthly' } }] } }]) {
    Object.assign(session, change); await assert.rejects(f.worker.runClaim(claim)); Object.assign(session, original);
  }
  assert.equal((await f.view(browser)).checkout?.state, 'queued');
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  await f.worker.runClaim(claim);
  assert.equal((await f.view(browser)).checkout?.state, 'open');
  assert.equal(f.sessions.size, 1);
});

test('compiled worker death after external checkout success recovers exactly one session and operation key', { timeout: 45000 }, async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.reserve(browser); await f.complete('billing.customer');
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  const entered = barrier(), release = barrier();
  f.barrier(async path => { if (path.startsWith('/v1/checkout/sessions/')) { entered.resolve(); await release.promise; } });
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: f.config.databaseUrl!, PUBLIC_ORIGIN: f.origin,
    COOKIE_SECURE: 'true', OIDC_ISSUER: f.issuer, OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-client-secret', ...sandboxSettings };
  const code = `import Stripe from 'stripe'; import { runBillingCommand } from './dist-server/billing/cli.js';
    const client = new Stripe(process.env.STRIPE_TEST_SECRET_KEY, { host: '127.0.0.1', port: ${f.port}, protocol: 'http',
      apiVersion: '${stripeApiVersion}', maxNetworkRetries: 0, timeout: 10000 }); await runBillingCommand('worker', client);`;
  const operation = await f.db.prepare("SELECT id,job_id FROM durable_operations WHERE kind='billing.checkout'").get(); assert.ok(operation);
  await boss.update('billing-checkout', undefined, { id: String(operation.job_id), expireInSeconds: 3 });
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, stdio: 'pipe' }), exit = once(child, 'exit');
  let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); });
  t.after(async () => { release.resolve(); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exit; });
  await Promise.race([entered.promise, exit.then(() => { throw new Error(`Synthetic worker exited before provider success: ${stderr}`); })]);
  child.kill('SIGKILL'); await exit; release.resolve(); f.barrier();
  assert.equal(f.sessions.size, 1);
  const [old] = await boss.findJobs<ClaimData>('billing-checkout', { id: String(operation.job_id) }); assert.ok(old);
  let recovered: JobClaim | undefined;
  const deadline = Date.now() + 25000;
  while (!recovered && Date.now() < deadline) { await delay(250); recovered = await f.worker.jobs.claim('billing.checkout'); }
  assert.ok(recovered, 'Maintained expiry/retry must recover the dead worker without manual fail or replay.');
  await f.worker.runClaim(recovered);
  assert.equal((await f.view(browser)).checkout?.state, 'open');
  assert.equal(f.sessions.size, 1);
  assert.deepEqual(f.requests.filter(request => request.path === '/v1/checkout/sessions' && request.method === 'POST').map(request => request.key), [operation.id]);
  await assert.rejects(f.worker.runClaim(old), LostJobClaim);
});

test('compiled reconciliation processes customer and checkout children, and a later bounded sweep refreshes open sessions without SDK writes', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.reserve(browser, 'pro_annual');
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: f.config.databaseUrl!, PUBLIC_ORIGIN: f.origin,
    COOKIE_SECURE: 'true', OIDC_ISSUER: f.issuer, OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-client-secret', ...sandboxSettings };
  const code = `import Stripe from 'stripe'; import { runBillingCommand } from './dist-server/billing/cli.js';
    const client = new Stripe(process.env.STRIPE_TEST_SECRET_KEY, { host: '127.0.0.1', port: ${f.port}, protocol: 'http',
      apiVersion: '${stripeApiVersion}', maxNetworkRetries: 0, timeout: 1000 }); await runBillingCommand('reconcile', client);`;
  const execute = promisify(execFile), result = await execute(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000 });
  assert.deepEqual(JSON.parse(result.stdout), { event: 'billing.sandbox.reconciled', completed: 3, authority: 'sandbox-ledger-observation-only' });
  assert.deepEqual((await f.view(browser)).checkout?.quote, { currency: 'usd', unitAmount: 19000 });
  Object.assign([...f.sessions.values()][0], { status: 'expired', url: null });
  const next = await execute(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000 });
  assert.equal(JSON.parse(next.stdout).completed, 1);
  assert.equal((await f.view(browser)).checkout?.state, 'expired');
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 2);
});

test('hosted URL and persisted intent validation reject unsafe redirects and noncanonical origins while preserving opaque hosted fragments', () => {
  assert.equal(hostedCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_Synthetic#opaque'), 'https://checkout.stripe.com/c/pay/cs_test_Synthetic#opaque');
  for (const value of ['javascript:alert(1)', 'https://foreign.fixture/c/pay/cs_test_Synthetic', 'https://checkout.stripe.com.evil.fixture/c/pay/test',
    'https://member@checkout.stripe.com/c/pay/test', 'https://checkout.stripe.com/elsewhere', 'https://checkout.stripe.com/c/pay/\ncs_test_Synthetic']) assert.throws(() => hostedCheckoutUrl(value));
  assert.equal(canonicalOriginSchema.safeParse('https://studio.fixture').success, true);
  for (const origin of ['https://studio.fixture/path', 'http://studio.fixture', 'https://member@studio.fixture', 'https://studio.fixture#fragment']) {
    assert.equal(canonicalOriginSchema.safeParse(origin).success, false);
  }
});
