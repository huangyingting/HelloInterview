import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { SandboxUsage, sandboxUsagePolicy, type ReservationRequest, type UsagePolicy } from '../server/usage';
import { Entitlements, type GrantRequest } from '../server/entitlements';
import { HttpError } from '../server/http-error';
import { digest } from '../server/jobs/schema';
import { DurableJobs, migrateJobs } from '../server/jobs';
import { openIdentityFixture } from './fixtures/identity';
import { monthlyUsageWindow } from '../server/usage/calendar';
import type { Database } from '../server/db/connection';
import { StateRepository } from '../server/db/state-repository';
import { migrations, migrateDatabase, assertDatabaseVersion } from '../server/db/migrations';
import { postgresConnection } from '../server/db/connection';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const proof = { actor: 'fixture-operator', reason: 'Synthetic sandbox usage contract evidence only.' };
const policy: UsagePolicy = { id: sandboxUsagePolicy, monthlyUnits: 5, costs: { tutor: 1, feedback: 2, mock: 2, project: 5 },
  dailyCostMicros: 1000, monthlyCostMicros: 10000, globalConcurrency: 2, ownerConcurrency: 1, maxQueueAgeMs: 300000 };
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
async function fixture(t: TestContext, input = policy, issue = true) {
  const f = await openIdentityFixture({ OPENAI_API_KEY: 'synthetic-unused-key', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' });
  t.after(() => f.close());
  const browser = f.browser();
  assert.equal((await f.complete(browser, await f.begin(browser))).status, 303);
  const owner = (await browser.bootstrap()).user?.id; assert.ok(owner);
  const entitlements = new Entitlements(f.db), usage = await SandboxUsage.open(f.db, input);
  const grant: GrantRequest = { owner, source: { kind: 'engineering', key: randomUUID() }, policy: 'pro-v1',
    startsAt: Date.now() - 1000, endsAt: Date.now() + 600000, evidence: proof };
  if (issue) await entitlements.issue(grant);
  const epoch = Number((await f.db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?').get(owner))?.session_epoch);
  const request = (kind: ReservationRequest['kind'] = 'tutor', costCeilingMicros = 10): ReservationRequest => ({
    owner, key: randomUUID(), authEpoch: epoch, kind, inputRef: 'fixture-input', inputRevision: 1, inputHash: digest('synthetic private input'),
    costCeilingMicros, consent: sandboxUsagePolicy, acknowledged: true, evidence: proof,
  });
  return { ...f, owner, browser, newBrowser: f.browser, entitlements, usage, grant, epoch, request, policy: input };
}
async function consume(f: Awaited<ReturnType<typeof fixture>>, input = f.request(), cost = 4) {
  const reservation = await f.usage.reserve(input); await f.usage.markDispatched(f.owner, reservation.id, proof);
  await f.usage.complete(f.owner, reservation.id, { resultHash: digest('fixture result'), actualCostMicros: cost, evidence: proof }, async () => {});
  return reservation;
}
function clockDatabase(db: Database, initial: number) {
  let now = initial;
  return { db: { ...db, prepare(sql: string) {
    const statement = db.prepare(sql);
    return sql.includes('floor(extract(epoch from clock_timestamp())*1000)::bigint AS now') ? { ...statement, get: async () => ({ now }) } : statement;
  } }, set: (value: number) => { now = value; } };
}
async function otherOwner(f: Awaited<ReturnType<typeof fixture>>) {
  const browser = f.newBrowser();
  assert.equal((await f.complete(browser, await f.begin(browser, 'github'), { sub: `github|${randomUUID()}`, email: `${randomUUID()}@example.invalid` })).status, 303);
  const owner = (await browser.bootstrap()).user?.id; assert.ok(owner);
  await f.entitlements.issue({ ...f.grant, owner, source: { ...f.grant.source, key: randomUUID() } });
  return { owner, epoch: Number((await f.db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?').get(owner))?.session_epoch) };
}

test('usage policies are explicit immutable trusted manifests, not silently changed limits or production AI authority', async t => {
  const f = await fixture(t), replica = await f.replica();
  await SandboxUsage.open(replica.db, policy);
  await assert.rejects(SandboxUsage.open(replica.db, { ...policy, monthlyUnits: 6 }), status(409));
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_policies').get())?.count, 1);
  assert.equal((await f.browser.bootstrap()).capabilities.ai, false);
  assert.equal(await f.entitlements.allows(f.owner, 'ai.feedback.consume'), false);
  await migrateJobs(f.db); const jobs = await DurableJobs.open(f.db); t.after(() => jobs.close());
  await assert.rejects(jobs.enqueue({ principal: { type: 'user', id: f.owner }, kind: 'ai.evaluate', key: randomUUID(),
    resource: 'fixture-input', payload: { consent: sandboxUsagePolicy }, retryMode: 'reconcile' }), status(403));
  assert.equal((await f.browser.request('/api/ai/reservations', {})).status, 404);
});

test('strict consent, finite ceilings, current verified account, exact epoch and current Pro are required before reserving', async t => {
  const f = await fixture(t, policy, false), input = f.request();
  await assert.rejects(f.usage.reserve(input), status(403));
  await f.entitlements.issue({ ...f.grant, policy: 'premium-read-v1' }); await assert.rejects(f.usage.reserve(input), status(403));
  await f.entitlements.issue({ ...f.grant, source: { ...f.grant.source, key: randomUUID() } });
  for (const invalid of [{ ...input, acknowledged: false }, { ...input, costCeilingMicros: -1 }, { ...input, inputHash: 'private text' },
    { ...input, consent: 'live-commercial' }, { ...input, provider: 'untrusted' }]) await assert.rejects(f.usage.reserve(invalid as ReservationRequest));
  await assert.rejects(f.usage.reserve({ ...input, authEpoch: f.epoch + 1 }), status(403));
  await f.db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(f.owner);
  await assert.rejects(f.usage.reserve(input), status(403));
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_reservations').get())?.count, 0);
});

test('replicas reserve exactly once and racing for the last weighted units admits only one immutable request', async t => {
  const f = await fixture(t), replica = await f.replica(), two = await SandboxUsage.open(replica.db, policy), input = f.request('project');
  const results = await Promise.all([f.usage.reserve(input), two.reserve(input), f.usage.reserve(input)]);
  assert.ok(results.every(result => result.id === results[0].id));
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_reservations').get())?.count, 1);
  assert.equal((await f.db.prepare('SELECT reserved FROM ai_usage_windows').get())?.reserved, 5);
  for (const change of [{ kind: 'feedback' as const }, { inputRevision: 2 }, { inputHash: digest('different input') }, { costCeilingMicros: 11 }]) {
    await assert.rejects(two.reserve({ ...input, ...change }), status(409));
  }
  await f.usage.release(f.owner, results[0].id, { actualCostMicros: 0, evidence: proof });
  const race = await Promise.allSettled([f.usage.reserve(f.request('project')), two.reserve(f.request('project'))]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(race.some(result => result.status === 'rejected' && status(429)(result.reason)));
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_events WHERE action=?').get('reserved'))?.count, 2);
});

test('overlapping replacement, revoked original service and duplicate sources reuse consumed allowance without changing grants or archives', async t => {
  const f = await fixture(t), states = new StateRepository(f.db);
  assert.equal((await f.browser.request('/api/mocks', { problemId: 'short-links', company: 'Meta', level: 'Senior', length: 3 })).status, 200);
  const archive = await states.read(f.owner), old = await f.db.prepare('SELECT * FROM entitlement_grants').get();
  await consume(f, f.request('project'));
  await f.entitlements.revoke(f.owner, f.grant.source, proof);
  await f.entitlements.issue({ ...f.grant, source: { kind: 'engineering', key: randomUUID() }, startsAt: f.grant.startsAt + 500 });
  const before = await f.db.prepare('SELECT id,anchor FROM ai_usage_lineages').get();
  await assert.rejects(f.usage.reserve(f.request()), status(429));
  assert.deepEqual(await f.db.prepare('SELECT id,anchor FROM ai_usage_lineages').get(), before);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_grants WHERE id=?').get(String(old?.id)), old);
  assert.deepEqual(await states.read(f.owner), archive);
  assert.equal((await f.db.prepare('SELECT consumed FROM ai_usage_windows').get())?.consumed, 5);
});

test('adjacent historical paid intervals retain the original month-end anchor rather than drifting after February', async t => {
  const f = await fixture(t, policy, false), anchor = Date.parse(`${new Date().getUTCFullYear() - 1}-01-31T12:34:56.789Z`);
  let start = anchor;
  while (start < Date.now()) {
    const window = monthlyUsageWindow(anchor, start);
    await f.entitlements.issue({ ...f.grant, source: { kind: 'promotion', key: randomUUID() }, startsAt: start, endsAt: window.endsAt });
    start = window.endsAt;
  }
  await f.usage.reserve(f.request());
  const saved = await f.db.prepare('SELECT starts_at,ends_at FROM ai_usage_windows').get(), expected = monthlyUsageWindow(anchor, Date.now());
  assert.equal(Number(saved?.starts_at), expected.startsAt); assert.equal(Number(saved?.ends_at), expected.endsAt);
  assert.equal(Number((await f.db.prepare('SELECT anchor FROM ai_usage_lineages').get())?.anchor), anchor);
});

test('a real gap creates a new lineage, but a later bridge across existing lineages holds for review rather than minting a third balance', async t => {
  const f = await fixture(t, policy, false), now = Date.now(), fake = clockDatabase(f.db, now - 100000);
  const usage = await SandboxUsage.open(fake.db, policy);
  const initial = { ...f.grant, startsAt: now - 120000, endsAt: now - 90000 };
  await f.entitlements.issue(initial);
  const first = await usage.reserve(f.request('project'));
  await usage.release(f.owner, first.id, { actualCostMicros: 0, evidence: proof });
  const next = { ...f.grant, source: { ...f.grant.source, key: randomUUID() }, startsAt: now - 60000, endsAt: now + 600000 };
  await f.entitlements.issue(next); fake.set(now);
  await usage.reserve(f.request());
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_lineages').get())?.count, 2);
  await f.entitlements.issue({ ...f.grant, source: { ...f.grant.source, key: randomUUID() }, startsAt: now - 95000, endsAt: now - 50000 });
  await assert.rejects(usage.reserve(f.request()), status(409));
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_windows').get())?.count, 2);
});

test('global daily and monthly cost ceilings serialize owners and account for actual cost separately from refunded user units', async t => {
  const f = await fixture(t, { ...policy, dailyCostMicros: 10, monthlyCostMicros: 10 }), other = await otherOwner(f);
  const initial = await f.usage.reserve(f.request('tutor', 7));
  await assert.rejects(f.usage.reserve({ ...f.request('tutor', 4), owner: other.owner, authEpoch: other.epoch }), status(429));
  await f.usage.markDispatched(f.owner, initial.id, proof);
  await f.usage.release(f.owner, initial.id, { actualCostMicros: 3, reconciled: true, evidence: proof });
  assert.equal((await f.db.prepare('SELECT reserved FROM ai_usage_windows WHERE owner_ref=?').get(f.owner))?.reserved, 0);
  const budgets = await f.db.prepare('SELECT reserved,consumed FROM ai_usage_cost_budgets').all();
  assert.ok(budgets.every(row => Number(row.reserved) === 0 && Number(row.consumed) === 3));
  await assert.rejects(f.usage.reserve({ ...f.request('tutor', 8), owner: other.owner, authEpoch: other.epoch }), status(429));
});

test('per-owner and global concurrency include unknown outcomes; elapsed time never releases their allowance or spend ceiling', async t => {
  const f = await fixture(t), other = await otherOwner(f);
  const a = await f.usage.reserve(f.request()), b = await f.usage.reserve(f.request());
  await f.usage.markDispatched(f.owner, a.id, proof); await f.usage.markUnknown(f.owner, a.id, proof);
  const replica = await f.replica(), recovered = await SandboxUsage.open(replica.db, policy);
  assert.deepEqual(await recovered.view(f.owner), await f.usage.view(f.owner));
  await assert.rejects(f.usage.markDispatched(f.owner, b.id, proof), status(429));
  const c = await f.usage.reserve({ ...f.request(), owner: other.owner, authEpoch: other.epoch });
  await f.usage.markDispatched(other.owner, c.id, proof);
  const third = await otherOwner(f), d = await f.usage.reserve({ ...f.request(), owner: third.owner, authEpoch: third.epoch });
  await assert.rejects(f.usage.markDispatched(third.owner, d.id, proof), status(429));
  await assert.rejects(f.usage.markDispatched(f.owner, a.id, proof), status(409));
  await assert.rejects(f.usage.release(f.owner, a.id, { actualCostMicros: 0, evidence: proof }), status(409));
  const before = await f.db.prepare('SELECT reserved FROM ai_usage_cost_budgets ORDER BY kind').all();
  await f.usage.markUnknown(f.owner, a.id, { ...proof, reason: 'A repeated observation preserves the first unknown evidence.' });
  assert.deepEqual(await f.db.prepare('SELECT reserved FROM ai_usage_cost_budgets ORDER BY kind').all(), before);
  await f.usage.release(f.owner, a.id, { actualCostMicros: 5, reconciled: true, evidence: proof });
  await f.usage.markDispatched(f.owner, b.id, proof);
});

test('completion and domain publication are atomic and exactly once; stale or failing publication does not consume or overwrite work', async t => {
  const f = await fixture(t), input = f.request('feedback'), a = await f.usage.reserve(input), states = new StateRepository(f.db);
  await f.usage.markDispatched(f.owner, a.id, proof);
  const result = { resultHash: digest('published fixture'), actualCostMicros: 6, evidence: proof };
  await assert.rejects(f.usage.complete(f.owner, a.id, result, async () => {
    await states.mutate(f.owner, state => { state.recognition = 7; }); throw new HttpError(409, 'Synthetic stale input.');
  }), status(409));
  assert.equal((await states.read(f.owner)).recognition, 0);
  assert.equal((await f.usage.view(f.owner)).reservations[0].state, 'dispatched');
  let published = 0;
  await f.usage.complete(f.owner, a.id, result, async () => { published++; await states.mutate(f.owner, state => { state.recognition = 7; }); });
  await f.usage.complete(f.owner, a.id, result, async () => { published++; });
  assert.equal(published, 1); assert.equal((await states.read(f.owner)).recognition, 7);
  await assert.rejects(f.usage.complete(f.owner, a.id, { ...result, actualCostMicros: 7 }, async () => {}), status(409));
  assert.equal((await f.db.prepare('SELECT consumed,reserved FROM ai_usage_windows').get())?.consumed, 2);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_events WHERE action=?').get('consumed'))?.count, 1);
});

test('settlement after reset belongs to its admission window and captured cost budgets, never the new month balance', async t => {
  const f = await fixture(t, policy, false), anchor = Date.parse('2000-01-31T00:00:00Z'),
    reset = Date.parse('2000-09-30T00:00:00Z'), fake = clockDatabase(f.db, reset - 1);
  await f.entitlements.issue({ ...f.grant, source: { kind: 'promotion', key: randomUUID() }, startsAt: anchor, endsAt: Date.parse('2001-01-31T00:00:00Z') });
  const usage = await SandboxUsage.open(fake.db, policy), input = f.request('project'), a = await usage.reserve(input);
  await usage.markDispatched(f.owner, a.id, proof); fake.set(reset);
  const b = await usage.reserve(f.request());
  await usage.complete(f.owner, a.id, { resultHash: digest('late result'), actualCostMicros: 3, evidence: proof }, async () => {});
  const windows = await f.db.prepare('SELECT starts_at,reserved,consumed FROM ai_usage_windows ORDER BY starts_at').all();
  assert.equal(windows.length, 2); assert.equal(windows[0].consumed, 5); assert.equal(windows[0].reserved, 0);
  assert.equal(windows[1].consumed, 0); assert.equal(windows[1].reserved, 1);
  assert.notEqual(a.id, b.id);
  assert.equal(Number((await f.db.prepare("SELECT consumed FROM ai_usage_cost_budgets WHERE kind='day' AND starts_at<?").get(reset))?.consumed), 3);
  assert.equal(Number((await f.db.prepare("SELECT consumed FROM ai_usage_cost_budgets WHERE kind='day' AND starts_at=?").get(reset))?.consumed), 0);
});

test('stale or future-dated queue age and ended captured budget windows reject new dispatch without resetting the reservation', async t => {
  const f = await fixture(t), fake = clockDatabase(f.db, Date.now()), usage = await SandboxUsage.open(fake.db, policy), a = await usage.reserve(f.request());
  const created = (await f.db.prepare('SELECT created_at FROM ai_usage_reservations WHERE id=?').get(a.id))?.created_at; assert.ok(created instanceof Date);
  for (const now of [created.getTime() - 1, created.getTime() + policy.maxQueueAgeMs]) {
    fake.set(now); await assert.rejects(usage.markDispatched(f.owner, a.id, proof), status(409));
  }
  assert.equal((await f.usage.view(f.owner)).reservations[0].state, 'reserved');
  await f.usage.release(f.owner, a.id, { actualCostMicros: 0, evidence: proof });
});

test('even a one-millisecond queued request cannot dispatch against yesterday captured cost capacity', async t => {
  const f = await fixture(t, policy, false), reset = Date.parse('2000-09-30T00:00:00Z'), fake = clockDatabase(f.db, reset - 1);
  await f.entitlements.issue({ ...f.grant, source: { kind: 'promotion', key: randomUUID() },
    startsAt: Date.parse('2000-09-01T00:00:00Z'), endsAt: Date.parse('2000-10-01T00:00:00Z') });
  const usage = await SandboxUsage.open(fake.db, policy), a = await usage.reserve(f.request());
  fake.set(reset);
  await assert.rejects(usage.markDispatched(f.owner, a.id, proof), status(409));
  assert.equal((await usage.view(f.owner)).reservations[0].state, 'reserved');
  await usage.release(f.owner, a.id, { actualCostMicros: 0, evidence: proof });
});

test('access revocation or security epoch movement before result publication keeps recorded costs and prevents result authority', async t => {
  for (const change of ['epoch', 'access']) {
    const f = await fixture(t), a = await f.usage.reserve(f.request()); await f.usage.markDispatched(f.owner, a.id, proof);
    if (change === 'epoch') await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
    else await f.entitlements.revoke(f.owner, f.grant.source, proof);
    let published = false;
    await assert.rejects(f.usage.complete(f.owner, a.id, { resultHash: digest('late result'), actualCostMicros: 4, evidence: proof },
      async () => { published = true; }), status(403));
    assert.equal(published, false);
    await f.usage.release(f.owner, a.id, { actualCostMicros: 4, reconciled: true, evidence: proof });
    assert.equal((await f.usage.view(f.owner)).reservations[0].state, 'released');
  }
});

test('actual admission SQL epoch movement rolls back reservation, balances and audit, witnessed outside the transaction', async t => {
  const f = await fixture(t);
  await f.db.executeSql(`CREATE SEQUENCE usage_admission_witness;
    CREATE FUNCTION move_usage_admission() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('usage_admission_witness'); UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=NEW.owner_ref;
    RETURN NEW; END $body$;
    CREATE TRIGGER move_usage_admission AFTER INSERT ON ai_usage_reservations FOR EACH ROW EXECUTE FUNCTION move_usage_admission();`);
  await assert.rejects(f.usage.reserve(f.request()), status(403));
  assert.equal((await f.db.prepare('SELECT is_called FROM usage_admission_witness').get())?.is_called, true);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_reservations').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_windows').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_events').get())?.count, 0);
});

test('actual dispatch SQL crossing the captured queue deadline cannot publish a marker or pretend that a provider was called', async t => {
  const f = await fixture(t, { ...policy, maxQueueAgeMs: 1000 }), a = await f.usage.reserve(f.request());
  await f.db.executeSql(`CREATE SEQUENCE usage_dispatch_witness;
    CREATE FUNCTION expire_usage_dispatch() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.state='dispatched' THEN PERFORM nextval('usage_dispatch_witness'); PERFORM pg_sleep(1.1); END IF; RETURN NEW; END $body$;
    CREATE TRIGGER expire_usage_dispatch AFTER UPDATE ON ai_usage_reservations FOR EACH ROW EXECUTE FUNCTION expire_usage_dispatch();`);
  await assert.rejects(f.usage.markDispatched(f.owner, a.id, proof), status(409));
  assert.equal((await f.db.prepare('SELECT is_called FROM usage_dispatch_witness').get())?.is_called, true);
  assert.equal((await f.usage.view(f.owner)).reservations[0].state, 'reserved');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM ai_usage_events WHERE action=?').get('dispatched'))?.count, 0);
});

test('actual settlement SQL security movement rolls result, units, provider cost and final receipt back together', async t => {
  const f = await fixture(t), a = await f.usage.reserve(f.request()); await f.usage.markDispatched(f.owner, a.id, proof);
  const states = new StateRepository(f.db);
  await f.db.executeSql(`CREATE SEQUENCE usage_settlement_witness;
    CREATE FUNCTION move_usage_settlement() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.state='consumed' THEN PERFORM nextval('usage_settlement_witness');
      UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=NEW.owner_ref; END IF; RETURN NEW; END $body$;
    CREATE TRIGGER move_usage_settlement AFTER UPDATE ON ai_usage_reservations FOR EACH ROW EXECUTE FUNCTION move_usage_settlement();`);
  await assert.rejects(f.usage.complete(f.owner, a.id, { resultHash: digest('fixture result'), actualCostMicros: 4, evidence: proof },
    async () => { await states.mutate(f.owner, state => { state.recognition = 20; }); }), status(403));
  assert.equal((await f.db.prepare('SELECT is_called FROM usage_settlement_witness').get())?.is_called, true);
  assert.equal((await states.read(f.owner)).recognition, 0);
  assert.equal((await f.usage.view(f.owner)).reservations[0].state, 'dispatched');
  assert.ok((await f.db.prepare('SELECT reserved,consumed FROM ai_usage_cost_budgets').all()).every(row => Number(row.reserved) === 10 && Number(row.consumed) === 0));
});

test('database-clock paid expiry during actual result SQL rolls publication back without releasing ambiguous dispatch', async t => {
  const f = await fixture(t, policy, false), states = new StateRepository(f.db);
  await f.entitlements.issue({ ...f.grant, endsAt: Date.now() + 3000 });
  const a = await f.usage.reserve(f.request()); await f.usage.markDispatched(f.owner, a.id, proof);
  await f.db.exec('CREATE SEQUENCE usage_expiry_witness');
  await assert.rejects(f.usage.complete(f.owner, a.id, { resultHash: digest('expired result'), actualCostMicros: 3, evidence: proof },
    async () => {
      await f.db.exec("SELECT nextval('usage_expiry_witness')");
      await states.mutate(f.owner, state => { state.recognition = 10; });
      await f.db.exec('SELECT pg_sleep(3.1)');
    }), status(403));
  assert.equal((await f.db.prepare('SELECT is_called FROM usage_expiry_witness').get())?.is_called, true);
  assert.equal((await states.read(f.owner)).recognition, 0);
  assert.equal((await f.usage.view(f.owner)).reservations[0].state, 'dispatched');
});

test('deletion retains ambiguous cost/units but removes user ownership, and trusted reconciled cleanup cannot publish into a replacement account', async t => {
  const f = await fixture(t), a = await f.usage.reserve(f.request()); await f.usage.markDispatched(f.owner, a.id, proof);
  await f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);
  await assert.rejects(f.usage.view(f.owner), status(403));
  await assert.rejects(f.usage.complete(f.owner, a.id, { resultHash: digest('orphan result'), actualCostMicros: 4, evidence: proof }, async () => {}), status(403));
  assert.equal((await f.db.prepare('SELECT user_id FROM ai_usage_reservations WHERE id=?').get(a.id))?.user_id, null);
  await f.usage.markUnknown(f.owner, a.id, proof);
  await f.usage.release(f.owner, a.id, { actualCostMicros: 4, reconciled: true, evidence: proof });
  assert.equal((await f.db.prepare('SELECT state FROM ai_usage_reservations WHERE id=?').get(a.id))?.state, 'released');
  const other = await otherOwner(f);
  await assert.rejects(f.usage.release(other.owner, a.id, { actualCostMicros: 0, evidence: proof }), status(404));
});

test('minimized owned history omits input/consent fingerprints, actor, source and provider-cost details, with explicit integrity errors', async t => {
  const f = await fixture(t), a = await f.usage.reserve(f.request());
  const view = await f.usage.view(f.owner);
  assert.equal(view.providerEnabled, false); assert.equal(view.reservations[0].id, a.id);
  for (const secret of ['fixture-input', 'synthetic private input', 'fixture-operator', 'request_payload', 'inputHash', 'costCeilingMicros']) {
    assert.ok(!JSON.stringify(view).includes(secret));
  }
  await f.db.prepare('DELETE FROM ai_usage_budget_links WHERE reservation_id=? AND kind=?').run(a.id, 'month');
  await assert.rejects(f.usage.view(f.owner), status(409));
});

test('partial null settlement and over-limit counters fail database constraints instead of producing success-shaped balances', async t => {
  const f = await fixture(t), a = await f.usage.reserve(f.request());
  await assert.rejects(f.db.prepare('UPDATE ai_usage_reservations SET settlement_hash=? WHERE id=?').run(digest('partial settlement'), a.id), /check constraint/);
  await assert.rejects(f.db.prepare('UPDATE ai_usage_windows SET reserved=unit_limit+1').run(), /check constraint/);
  await f.usage.markDispatched(f.owner, a.id, proof);
  await assert.rejects(f.usage.complete(f.owner, a.id, { resultHash: digest('over ceiling'), actualCostMicros: 11, evidence: proof }, async () => {}), status(409));
  assert.equal((await f.usage.view(f.owner)).reservations[0].state, 'dispatched');
});

test('retained calendar or provider balance drift is an explicit reconciliation error, not a fabricated remaining allowance', async t => {
  for (const change of ['calendar', 'balance']) {
    const f = await fixture(t); await f.usage.reserve(f.request());
    if (change === 'calendar') await f.db.exec('UPDATE ai_usage_windows SET ends_at=ends_at+1');
    else await f.db.exec('UPDATE ai_usage_cost_budgets SET reserved=reserved+1');
    await assert.rejects(f.usage.view(f.owner), status(409));
  }
});

test('controlled migration 17 preserves actual migration-16 identity, entitlement and original schema history', async t => {
  const f = await fixture(t), schema = `usage_upgrade_${randomUUID().replaceAll('-', '')}`; assert.ok(f.config.databaseUrl);
  const source = new URL(f.config.databaseUrl).searchParams.get('options')?.match(/search_path=([a-z0-9_]+)/)?.[1]; assert.ok(source);
  const url = new URL(f.config.databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
  await f.db.exec(`CREATE SCHEMA "${schema}"`); const legacy = postgresConnection(url.href);
  t.after(async () => { try { await legacy.exec(`DROP SCHEMA "${schema}" CASCADE`); } finally { await legacy.close(); } });
  await legacy.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const migration of migrations.filter(migration => migration.version <= 16)) {
    await legacy.exec(migration.sql);
    await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)').run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'));
  }
  for (const table of ['users', 'managed_identities', 'managed_accounts', 'entitlement_grants', 'entitlement_events']) {
    const columns = (await legacy.prepare('SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position')
      .all(schema, table)).map(row => String(row.column_name)); assert.ok(columns.every(column => /^[a-z_][a-z0-9_]*$/.test(column)));
    await legacy.exec(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.join(',')} FROM "${source}".${table}`);
  }
  const grants = await legacy.prepare('SELECT * FROM entitlement_grants').all(), accounts = await legacy.prepare('SELECT * FROM managed_accounts').all();
  const applied = await legacy.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all();
  await migrateDatabase(legacy); await migrateDatabase(legacy); await assertDatabaseVersion(legacy);
  assert.deepEqual(await legacy.prepare('SELECT * FROM entitlement_grants').all(), grants);
  assert.deepEqual(await legacy.prepare('SELECT * FROM managed_accounts').all(), accounts);
  assert.deepEqual(await legacy.prepare('SELECT version,checksum FROM schema_migrations WHERE version<=16 ORDER BY version').all(), applied);
  assert.equal((await legacy.prepare('SELECT count(*)::integer AS count FROM ai_usage_reservations').get())?.count, 0);
});

test('compiled usage domain operates the same owned reservation and immutable policy without development loaders', async t => {
  const f = await fixture(t), input = f.request(); assert.ok(f.config.databaseUrl);
  const code = `import {SandboxUsage} from './dist-server/usage/index.js';
    import {postgresConnection} from './dist-server/jobs/index.js';
    const db=postgresConnection(process.env.USAGE_FIXTURE_DATABASE);
    try{const usage=await SandboxUsage.open(db,JSON.parse(process.env.USAGE_FIXTURE_POLICY));
      console.log(JSON.stringify(await usage.reserve(JSON.parse(process.env.USAGE_FIXTURE_REQUEST))));}
    finally{await db.close();}`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { timeout: 15000,
    env: { PATH: process.env.PATH, USAGE_FIXTURE_DATABASE: f.config.databaseUrl,
      USAGE_FIXTURE_POLICY: JSON.stringify(policy), USAGE_FIXTURE_REQUEST: JSON.stringify(input) } });
  assert.deepEqual(JSON.parse(result.stdout), await f.usage.reserve(input));
  assert.equal((await f.usage.view(f.owner)).reservations.length, 1);
});
