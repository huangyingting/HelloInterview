import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authJsEnvironment, openBillingFixture, sandboxSettings } from './fixtures/billing';
import { sandboxRecheckoutAuthority } from '../shared/billing';
import { sandboxServicePolicy } from '../shared/billing-ledger';
import { BillingNotifications } from '../server/billing';
import { TerminalJobFailure, LostJobClaim } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';
import { migrations, migrateDatabase, assertDatabaseVersion } from '../server/db/migrations';
import { postgresConnection } from '../server/db/connection';
import { stripeApiVersion } from '../server/billing/schema';
import { problems } from '../shared/catalog';

async function fixture(t: TestContext, service = false, ended = true) {
  const f = await openBillingFixture(t, service ? { STRIPE_TEST_ACCESS_POLICY: sandboxServicePolicy } : {}), { browser, owner } = await f.login();
  const original = await f.reserve(browser); await f.complete('billing.customer'); await f.complete('billing.checkout');
  const facts = await f.settleCheckout();
  assert.equal((await browser.request(`/api/billing/checkouts/${original.id}/refresh`, {})).status, 200);
  await f.complete('billing.checkout.refresh'); await f.complete('billing.customer.snapshot'); await f.complete('billing.customer.snapshot');
  if (ended) {
    facts.sub.status = 'canceled';
    assert.equal((await browser.request('/api/billing/reconcile', {})).status, 202); await f.complete('billing.customer.snapshot');
  }
  const sub = (await f.view(browser)).ledger?.subscriptions[0]; assert.ok(sub);
  assert.equal((await f.view(browser)).checkout?.subscriptionRef, sub.id);
  return { ...f, browser, owner, original, facts, sub };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const body = (f: Fixture, key = randomUUID()) => ({ key, offer: 'pro_annual' as const, previousSubscriptionRef: f.sub.id, acknowledged: true as const });
async function reserve(f: Fixture, input = body(f)) {
  const { key, offer, previousSubscriptionRef, acknowledged } = input;
  const response = await f.browser.request('/api/billing/checkouts', { key, offer, previousSubscriptionRef, acknowledged });
  assert.equal(response.status, 202, await response.clone().text());
  const result: { id: string } = await response.json(); return { ...input, ...result };
}
const posts = (f: Fixture) => f.requests.filter(request => request.path === '/v1/checkout/sessions' && request.method === 'POST');
async function refreshLedger(f: Fixture) {
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202); await f.complete('billing.customer.snapshot');
}
async function settleNew(f: Fixture, id: string) {
  const facts = await f.settleCheckout();
  assert.equal((await f.browser.request(`/api/billing/checkouts/${id}/refresh`, {})).status, 200);
  await f.complete('billing.checkout.refresh'); await f.complete('billing.customer.snapshot'); return facts;
}

test('fresh strict owned recheckout admission requires exact opaque ended predecessor and new acknowledgment with replica deduplication', async t => {
  const f = await fixture(t), request = body(f);
  assert.equal((await f.browser.request('/api/billing/checkouts', request, 'POST', { 'X-CSRF-Token': 'wrong' })).status, 403);
  for (const input of [{ ...request, acknowledged: false }, { key: request.key, offer: request.offer, previousSubscriptionRef: f.sub.id },
    { ...request, previousSubscriptionRef: f.facts.sub.id }, { ...request, customer: f.facts.sub.customer }, { ...request, subscription: f.facts.sub.id }]) {
    assert.equal((await f.browser.request('/api/billing/checkouts', input)).status, 400);
  }
  assert.equal((await f.browser.request('/api/billing/checkouts', { ...request, previousSubscriptionRef: randomUUID() })).status, 404);
  assert.equal((await f.browser.request('/api/billing/checkouts', { key: randomUUID(), offer: request.offer })).status, 409);
  const stranger = await f.login(undefined, 'google|recheckout-stranger');
  assert.equal((await stranger.browser.request('/api/billing/checkouts', request)).status, 404);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_owned_customers').get())?.count, 1);
  const replica = await f.replica(), browser = replica.browser();
  for (const [key, value] of f.browser.cookies) browser.cookies.set(key, value);
  await browser.bootstrap();
  const before = f.requests.length, [first, second] = await Promise.all([reserve(f, request), browser.request('/api/billing/checkouts', request)]);
  assert.equal(second.status, 202); assert.equal((await second.json()).id, first.id); assert.equal((await reserve(f, request)).id, first.id);
  assert.equal(f.requests.length, before); assert.equal((await f.view(f.browser)).checkout?.id, first.id);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_checkout_attempts').get())?.count, 2);
  assert.equal((await f.browser.request('/api/billing/checkouts', { ...request, offer: 'pro_monthly' })).status, 409);
  assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 409);
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=authenticated_at-660000 WHERE token IN (SELECT token FROM sessions WHERE user_id=?)').run(f.owner);
  assert.equal((await f.browser.request('/api/billing/checkouts', request)).status, 403);
});

test('same-customer eight-call new annual session preserves original Checkout, renewal history, paid source, audit, money and real premium archive', async t => {
  const f = await fixture(t, true), original = await f.db.prepare('SELECT * FROM stripe_checkout_attempts WHERE id=?').get(f.original.id),
    grants = await f.db.prepare('SELECT * FROM entitlement_grants').all(), events = await f.db.prepare('SELECT * FROM entitlement_events').all(),
    invoice = structuredClone(f.facts.invoice);
  const problem = problems.find(problem => problem.premium); assert.ok(problem);
  assert.equal((await f.browser.request('/api/mocks', { problemId: problem.id, company: 'Meta', level: 'Senior', length: 3 })).status, 200);
  const archive = (await f.browser.bootstrap()).state.mocks;
  const attempt = await reserve(f), before = f.requests.length, operation = await f.complete('billing.checkout');
  assert.equal(f.requests.length - before, 8); assert.equal(operation.receipt?.authority, sandboxRecheckoutAuthority);
  const view = await f.view(f.browser);
  assert.equal(view.checkout?.id, attempt.id); assert.equal(view.checkout?.state, 'open');
  assert.equal(view.checkout?.previousSubscriptionRef, f.sub.id); assert.equal(view.checkout?.subscriptionRef, null);
  assert.deepEqual(view.checkout?.quote, { currency: 'usd', unitAmount: 19000 });
  assert.equal(f.customers.size, 1); assert.equal(f.sessions.size, 2);
  assert.deepEqual(await f.db.prepare('SELECT * FROM stripe_checkout_attempts WHERE id=?').get(f.original.id), original);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_grants').all(), grants);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_events').all(), events);
  assert.deepEqual((await f.browser.bootstrap()).state.mocks, archive); assert.deepEqual(f.facts.invoice, invoice);
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'pro');
  assert.equal((await f.browser.request(`/api/billing/checkouts/${attempt.id}/open`, {})).status, 200);
  const posted = posts(f).at(-1); assert.ok(posted);
  assert.equal(posted.key, operation.id);
  assert.equal((await f.db.prepare('SELECT recheckout_acknowledged FROM stripe_checkout_attempts WHERE id=?').get(attempt.id))?.recheckout_acknowledged, 1);
  for (const secret of ['cus_Synthetic', 'sub_Synthetic', 'price_Synthetic', 'authEpoch']) assert.ok(!JSON.stringify(view).includes(secret));
});

test('only independently funded new service evidence creates a distinct interval and old source/audit cannot be overwritten or reset', async t => {
  const f = await fixture(t, true), original = await f.db.prepare('SELECT * FROM entitlement_grants').get(),
    events = await f.db.prepare('SELECT * FROM entitlement_events').all();
  const attempt = await reserve(f); await f.complete('billing.checkout');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 1);
  const facts = await settleNew(f, attempt.id);
  const grants = await f.db.prepare('SELECT * FROM entitlement_grants ORDER BY id').all(); assert.equal(grants.length, 2);
  assert.deepEqual(grants.find(grant => grant.id === original?.id), original);
  const newer = grants.find(grant => grant.id !== original?.id); assert.ok(newer);
  assert.equal(Number(newer.starts_at), facts.line.period.start * 1000); assert.equal(Number(newer.ends_at), (facts.line.period.end + 1) * 1000);
  assert.notEqual(newer.source_key, original?.source_key);
  const laterEvents = await f.db.prepare('SELECT * FROM entitlement_events').all();
  for (const event of events) assert.deepEqual(laterEvents.find(row => row.id === event.id), event);
  assert.equal((await f.view(f.browser)).checkout?.id, attempt.id);
  assert.equal((await f.view(f.browser)).ledger?.subscriptions.length, 2);
});

test('observation-only recheckout remains Free after complete test payment and never enables live commerce or paid sources', async t => {
  const f = await fixture(t), attempt = await reserve(f); await f.complete('billing.checkout'); await settleNew(f, attempt.id);
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'free'); assert.equal((await f.browser.bootstrap()).capabilities.commerce, 'disabled');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
});

test('an active, nonrenewing, dirty, stale or future-dated predecessor cannot authorize another Checkout', async t => {
  const f = await fixture(t, false, false);
  for (const flag of [false, true]) {
    f.facts.sub.cancel_at_period_end = flag; await refreshLedger(f);
    assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 409);
  }
  f.facts.sub.status = 'canceled'; await refreshLedger(f);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 409); await f.complete('billing.customer.snapshot');
  for (const value of ["clock_timestamp()-interval '5 minutes'", "clock_timestamp()+interval '1 minute'"]) {
    await f.db.exec(`UPDATE stripe_customer_ledger_state SET observed_at=${value}`);
    assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 409);
  }
  assert.equal(posts(f).length, 1);
});

test('unknown durable renewal control outcomes require reconciliation before a new subscription rather than replacing consent', async t => {
  const f = await fixture(t, false, false);
  assert.equal((await f.browser.request(`/api/billing/subscriptions/${f.sub.id}/cancel`, {})).status, 202);
  f.facts.sub.status = 'canceled'; await refreshLedger(f);
  assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 409);
  await f.complete('billing.subscription.cancel'); await f.complete('billing.customer.snapshot');
  await reserve(f); assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_subscription_cancellations').get())?.count, 1);
});

test('missing current cursor is an explicit owned error, never an empty account that can mint a replacement intent', async t => {
  const f = await fixture(t); await f.db.prepare('DELETE FROM stripe_customer_checkout_cursor').run();
  const response = await f.browser.request('/api/billing'); assert.equal(response.status, 409);
  assert.match(await response.text(), /cursor is missing/);
  assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 409);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_checkout_attempts').get())?.count, 1);
});

test('database predecessor/acknowledgment constraints reject partial null authority without weakening old history', async t => {
  const f = await fixture(t), attempt = await reserve(f);
  for (const column of ['recheckout_acknowledged', 'previous_attempt_id', 'previous_subscription_ref', 'previous_subscription_id']) {
    await assert.rejects(f.db.prepare(`UPDATE stripe_checkout_attempts SET ${column}=NULL WHERE id=?`).run(attempt.id), /stripe_recheckout_scope/);
  }
  assert.equal((await f.db.prepare('SELECT state FROM stripe_checkout_attempts WHERE id=?').get(f.original.id))?.state, 'complete');
  assert.equal((await f.view(f.browser)).checkout?.id, attempt.id);
});

test('foreign, absent or conflicting canonical parent and newly active customer subscriptions fail before new hosted POST', async t => {
  const f = await fixture(t), attempt = await reserve(f), claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  const original = structuredClone(f.facts.sub);
  for (const change of [{ customer: 'cus_Foreign' }, { status: 'active' }, { metadata: { studio_customer_ref: randomUUID(), studio_checkout_ref: f.original.id } },
    { metadata: { studio_customer_ref: original.metadata.studio_customer_ref, studio_checkout_ref: randomUUID() } }]) {
    Object.assign(f.facts.sub, structuredClone(original), change); await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 1);
  }
  Object.assign(f.facts.sub, original); f.subscriptions.pop(); await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  f.subscriptions.push(f.facts.sub); f.subscriptions.push({ ...original, id: 'sub_UnexpectedActive', status: 'active' });
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(posts(f).length, 1);
  assert.equal((await f.view(f.browser)).checkout?.id, attempt.id);
});

test('ownership and current cursor movement at the last SDK boundary fence prepared writes', async t => {
  for (const change of ['epoch', 'mapping', 'cursor', 'dirty']) {
    const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
    f.barrier(async (path, method) => {
      if (path === '/v1/subscriptions' && method === 'GET') {
        f.barrier();
        if (change === 'epoch') await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
        if (change === 'mapping') await f.db.prepare("UPDATE stripe_owned_customers SET customer_id='cus_Moved' WHERE user_id=?").run(f.owner);
        if (change === 'cursor') await f.db.prepare('UPDATE stripe_customer_checkout_cursor SET attempt_id=?').run(f.original.id);
        if (change === 'dirty') await f.db.prepare('UPDATE stripe_customer_ledger_state SET requested_revision=requested_revision+1').run();
      }
    });
    await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 1);
    assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  }
});

test('withdrawn or remapped catalogs hold a new prepared write while the original hosted result can recover read-only', async t => {
  const f = await fixture(t); assert.ok(f.config.billing); await reserve(f);
  const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  const shutdown = new AbortController(), changed = await BillingNotifications.open(f.db, { ...f.config.billing, offers: null }, shutdown.signal, true, f.client, f.origin);
  f.cleanup.push(async () => { shutdown.abort(); await changed.close(); });
  const remapped = await BillingNotifications.open(f.db, { ...f.config.billing,
    offers: { pro_monthly: 'price_SyntheticMonthly', pro_annual: 'price_Remapped' } }, shutdown.signal, true, f.client, f.origin);
  f.cleanup.push(() => remapped.close());
  await assert.rejects(remapped.runClaim(claim)); assert.equal(posts(f).length, 1);
  await assert.rejects(changed.runClaim(claim)); assert.equal(posts(f).length, 1);
  await f.db.executeSql(`CREATE FUNCTION fail_recheckout_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.previous_subscription_ref IS NOT NULL THEN RAISE EXCEPTION 'lost recheckout publication'; END IF; RETURN NEW; END $body$;
    CREATE TRIGGER fail_recheckout_publication BEFORE UPDATE ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION fail_recheckout_publication();`);
  await assert.rejects(f.worker.runClaim(claim), /lost recheckout publication/); assert.equal(posts(f).length, 2);
  await f.db.exec('DROP TRIGGER fail_recheckout_publication ON stripe_checkout_attempts');
  f.prices.get('price_SyntheticAnnual')!.active = false; f.product.active = false;
  await f.db.prepare("UPDATE durable_operations SET created_at=clock_timestamp()-interval '21 hours' WHERE id=?").run(claim.data.operationId);
  const before = f.requests.length; await changed.runClaim(claim); assert.equal(f.requests.length - before, 6);
  assert.equal(posts(f).length, 2); assert.equal((await f.view(f.browser)).checkout?.state, 'open');
});

test('SQL admission epoch changes roll the new intent, queue and cursor back while proving actual writes occurred', async t => {
  const f = await fixture(t);
  await f.db.executeSql(`CREATE SEQUENCE recheckout_admission_witness;
    CREATE FUNCTION change_recheckout_admission() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.previous_subscription_ref IS NOT NULL THEN PERFORM nextval('recheckout_admission_witness');
      UPDATE managed_accounts SET session_epoch=session_epoch+1; END IF; RETURN NEW; END $body$;
    CREATE TRIGGER change_recheckout_admission AFTER INSERT ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION change_recheckout_admission();`);
  assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 403);
  assert.equal((await f.db.prepare('SELECT is_called FROM recheckout_admission_witness').get())?.is_called, true);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_checkout_attempts').get())?.count, 1);
  assert.equal((await f.view(f.browser)).checkout?.id, f.original.id); assert.equal(await f.worker.jobs.claim('billing.checkout'), undefined);
});

test('SQL cursor drift after actual hosted publication rolls back the local result and retains honest unknown external success', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE recheckout_publication_witness;
    CREATE FUNCTION change_recheckout_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.previous_subscription_ref IS NOT NULL THEN PERFORM nextval('recheckout_publication_witness');
      UPDATE stripe_customer_checkout_cursor SET attempt_id=NEW.previous_attempt_id WHERE customer_ref=NEW.customer_ref;
      END IF; RETURN NEW; END $body$;
    CREATE TRIGGER change_recheckout_publication AFTER UPDATE ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION change_recheckout_publication();`);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.db.prepare('SELECT is_called FROM recheckout_publication_witness').get())?.is_called, true);
  assert.equal((await f.view(f.browser)).checkout?.state, 'queued'); assert.equal(posts(f).length, 2);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('SQL customer mapping changes after admission or hosted publication roll back rather than confirm a stale target', async t => {
  for (const phase of ['admission', 'publication']) {
    const f = await fixture(t);
    const attempt = phase === 'publication' ? await reserve(f) : null;
    const claim = attempt ? await f.worker.jobs.claim('billing.checkout') : null;
    await f.db.executeSql(`CREATE SEQUENCE recheckout_mapping_witness;
      CREATE FUNCTION change_recheckout_mapping() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN IF NEW.previous_subscription_ref IS NOT NULL THEN PERFORM nextval('recheckout_mapping_witness');
        UPDATE stripe_owned_customers SET customer_id='cus_Moved' WHERE id=NEW.customer_ref;
        END IF; RETURN NEW; END $body$;
      CREATE TRIGGER change_recheckout_mapping AFTER ${phase === 'admission' ? 'INSERT' : 'UPDATE'}
        ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION change_recheckout_mapping();`);
    if (claim) {
      await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
      assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
      assert.equal((await f.view(f.browser)).checkout?.state, 'queued');
    } else {
      assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 403);
      assert.equal((await f.view(f.browser)).checkout?.id, f.original.id);
      assert.equal(await f.worker.jobs.claim('billing.checkout'), undefined);
    }
    assert.equal((await f.db.prepare('SELECT is_called FROM recheckout_mapping_witness').get())?.is_called, true);
    assert.equal((await f.db.prepare('SELECT customer_id FROM stripe_owned_customers').get())?.customer_id, 'cus_Synthetic1');
    assert.equal(posts(f).length, phase === 'admission' ? 1 : 2);
  }
});

test('native expiry during real new-hosted SQL rolls publication and completion back after external creation', async t => {
  const f = await fixture(t); await reserve(f);
  const row = await f.db.prepare("SELECT job_id FROM durable_operations WHERE kind='billing.checkout' AND receipt IS NULL").get(); assert.ok(row);
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  await boss.update('billing-checkout', undefined, { id: String(row.job_id), expireInSeconds: 2 });
  const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE recheckout_expiry_witness;
    CREATE FUNCTION expire_recheckout_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.previous_subscription_ref IS NOT NULL THEN PERFORM nextval('recheckout_expiry_witness'); PERFORM pg_sleep(2.1); END IF; RETURN NEW; END $body$;
    CREATE TRIGGER expire_recheckout_publication AFTER UPDATE ON stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION expire_recheckout_publication();`);
  await assert.rejects(f.worker.runClaim(claim), LostJobClaim);
  assert.equal((await f.db.prepare('SELECT is_called FROM recheckout_expiry_witness').get())?.is_called, true);
  assert.equal((await f.view(f.browser)).checkout?.state, 'queued'); assert.equal(posts(f).length, 2);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('deletion after provider creation never publishes or retries an unowned hosted result', async t => {
  const f = await fixture(t); await reserve(f); const claim = await f.worker.jobs.claim('billing.checkout'); assert.ok(claim);
  f.barrier(async (path, method) => {
    if (path === '/v1/checkout/sessions/cs_test_Synthetic2' && method === 'GET') {
      f.barrier(); await f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);
    }
  });
  await assert.rejects(f.worker.runClaim(claim)); assert.equal(posts(f).length, 2);
  assert.equal((await f.db.prepare('SELECT user_id FROM stripe_owned_customers').get())?.user_id, null);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  const before = f.requests.length; await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); assert.equal(f.requests.length, before);
});

test('known expired recheckout advances only its current cursor; old keys and older ended predecessors cannot replace later cycles', async t => {
  const f = await fixture(t), first = await reserve(f); await f.complete('billing.checkout');
  const session = f.sessions.get('cs_test_Synthetic2'); assert.ok(session); Object.assign(session, { status: 'expired', url: null });
  assert.equal((await f.browser.request(`/api/billing/checkouts/${first.id}/refresh`, {})).status, 200); await f.complete('billing.checkout.refresh');
  assert.equal((await f.view(f.browser)).checkout?.id, first.id); assert.equal((await f.view(f.browser)).checkout?.state, 'expired');
  const second = await reserve(f); assert.notEqual(second.id, first.id); await f.complete('billing.checkout'); const facts = await settleNew(f, second.id);
  facts.sub.status = 'canceled'; await refreshLedger(f);
  assert.equal((await f.browser.request('/api/billing/checkouts', body(f))).status, 409);
  const before = f.requests.length; assert.equal((await reserve(f, first)).id, first.id);
  assert.equal((await f.reserve(f.browser, f.original.offer, f.original.key)).id, f.original.id);
  assert.equal(f.requests.length, before); assert.equal((await f.view(f.browser)).checkout?.id, second.id);
  const currentRef = (await f.view(f.browser)).checkout?.subscriptionRef; assert.ok(currentRef);
  const next = await reserve(f, { ...body(f), previousSubscriptionRef: currentRef });
  assert.notEqual(next.id, second.id);
  assert.equal((await f.browser.request(`/api/billing/checkouts/${first.id}/open`, {})).status, 409);
});

test('incomplete-expired owned completion can prepare another Checkout without issuing an entitlement', async t => {
  const f = await fixture(t, false, false); f.facts.sub.status = 'incomplete_expired'; await refreshLedger(f);
  await reserve(f); await f.complete('billing.checkout');
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'free'); assert.equal(posts(f).length, 2);
});

test('migration 16 backfills the actual migration-15 current slot without changing historical rows or operation payloads', async t => {
  const f = await fixture(t), schema = `rc_upgrade_${randomUUID().replaceAll('-', '')}`; assert.ok(f.config.databaseUrl);
  const source = new URL(f.config.databaseUrl).searchParams.get('options')?.match(/search_path=([a-z0-9_]+)/)?.[1]; assert.ok(source);
  const url = new URL(f.config.databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
  await f.db.exec(`CREATE SCHEMA "${schema}"`); const legacy = postgresConnection(url.href);
  f.cleanup.push(async () => { await legacy.close(); await f.db.exec(`DROP SCHEMA "${schema}" CASCADE`); });
  await legacy.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const migration of migrations.filter(migration => migration.version <= 15)) {
    await legacy.exec(migration.sql);
    await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)').run(migration.version, migration.name,
      createHash('sha256').update(migration.sql).digest('hex'));
  }
  for (const table of ['users', 'durable_operations', 'stripe_billing_reference', 'stripe_owned_customers', 'stripe_checkout_attempts', 'stripe_owned_subscription_ledger']) {
    const columns = (await legacy.prepare('SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position')
      .all(schema, table)).map(row => String(row.column_name)); assert.ok(columns.every(column => /^[a-z_][a-z0-9_]*$/.test(column)));
    await legacy.exec(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.join(',')} FROM "${source}".${table}`);
  }
  const rows = await legacy.prepare('SELECT id,state,session_id,subscription_id,request_key FROM stripe_checkout_attempts').all(),
    payloads = await legacy.prepare('SELECT payload,receipt FROM durable_operations ORDER BY id').all();
  await migrateDatabase(legacy); await migrateDatabase(legacy); await assertDatabaseVersion(legacy);
  assert.deepEqual(await legacy.prepare('SELECT id,state,session_id,subscription_id,request_key FROM stripe_checkout_attempts').all(), rows);
  assert.deepEqual(await legacy.prepare('SELECT payload,receipt FROM durable_operations ORDER BY id').all(), payloads);
  assert.equal((await legacy.prepare('SELECT attempt_id FROM stripe_customer_checkout_cursor').get())?.attempt_id, f.original.id);
});

test('compiled maintained reconciliation creates the exact new owned hosted session without development loaders or another customer', async t => {
  const f = await fixture(t), attempt = await reserve(f); assert.ok(f.config.databaseUrl);
  const code = `import Stripe from 'stripe';import {runBillingCommand} from './dist-server/billing/cli.js';
    const client=new Stripe(process.env.STRIPE_TEST_SECRET_KEY,{host:'127.0.0.1',port:${f.port},protocol:'http',
      apiVersion:'${stripeApiVersion}',timeout:1000,maxNetworkRetries:0});await runBillingCommand('reconcile',client);`;
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,NODE_ENV:'production',DATABASE_URL:f.config.databaseUrl,
    ...authJsEnvironment(f.origin),...sandboxSettings};
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { timeout: 30000,
    env });
  assert.equal((await f.view(f.browser)).checkout?.id, attempt.id); assert.equal((await f.view(f.browser)).checkout?.state, 'open');
  assert.equal(f.customers.size, 1); assert.equal(posts(f).length, 2);
});
