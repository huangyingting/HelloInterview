import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { SupportHistory, SupportReceipt } from '../shared/types';
import { postgresConnection } from '../server/db/connection';
import { assertDatabaseVersion, migrateDatabase, migrations } from '../server/db/migrations';
import { IdentityLimits } from '../server/identity/limits';
import { SupportRequests } from '../server/support';
import { HttpError } from '../server/http-error';
import { openIdentityFixture, type IdentityBrowser } from './fixtures/identity';
import { appendStaffRole } from '../server/staff';

const body = 'A synthetic private support request about recovering my saved preparation.';
const command = (): { key: string; email: string; body: string } => ({ key: randomUUID(), email: 'support-owner@example.invalid', body });
async function fixture(t: TestContext) {
  const f = await openIdentityFixture(); t.after(f.close);
  const browser = f.browser(); await f.complete(browser, await f.begin(browser));
  const user = (await browser.bootstrap()).user; assert.ok(user);
  return { ...f, newBrowser: f.browser, browser, owner: user.id };
}
async function save(browser: IdentityBrowser, input = command()): Promise<SupportReceipt> {
  const response = await browser.request('/api/support', input);
  assert.equal(response.status, 200); return response.json();
}
async function history(browser: IdentityBrowser, cursor?: string): Promise<SupportHistory> {
  const response = await browser.request(`/api/support/requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  assert.equal(response.status, 200); return response.json();
}

test('owned support replicas and exact retry pin one private receipt without provider delivery or audit metadata leakage', async t => {
  const f = await fixture(t), replica = await f.replica(), browser = replica.browser(), input = command();
  for (const [name, value] of f.browser.cookies) browser.cookies.set(name, value);
  browser.csrf = f.browser.csrf;
  const results = await Promise.all([save(f.browser, input), save(browser, input), save(f.browser, input)]);
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
  assert.deepEqual(await save(browser, { ...input, key: input.key.toUpperCase() }), results[0]);
  assert.deepEqual(Object.keys(results[0]).sort(), ['body', 'createdAt', 'delivery', 'email', 'handlingStatus', 'id', 'replies', 'status']);
  assert.equal(results[0].status, 'saved'); assert.equal(results[0].delivery, 'not-connected');
  assert.equal(results[0].handlingStatus,'open');assert.deepEqual(results[0].replies,[]);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM support').get())?.count, 1);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM durable_operations').get())?.count, 0);
  assert.deepEqual((await history(browser)).tickets, [results[0]]);
});

test('owned support rejects changed retry content, unknown authority fields, missing keys and CSRF without changing saved text', async t => {
  const f = await fixture(t), input = command(), saved = await save(f.browser, input);
  for (const change of [{ body: `${body} Changed text.` }, { email: 'different@example.invalid' }]) {
    assert.equal((await f.browser.request('/api/support', { ...input, ...change })).status, 409);
  }
  for (const invalid of [{ ...input, owner: randomUUID() }, { ...input, delivery: 'delivered' },
    { email: input.email, body }, { ...input, body: 'short' }, { ...input, body: 'x'.repeat(10001) },
    { ...input, body: `${body}\0` }, { ...input, email: 'invalid\0@example.invalid' }]) {
    assert.equal((await f.browser.request('/api/support', invalid)).status, 400);
  }
  assert.equal((await f.browser.request('/api/support', command(), 'POST', { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.deepEqual((await history(f.browser)).tickets, [saved]);
});

test('support cannot use a different authority adapter or adopt a serialized member object as authenticated session authority', async t => {
  const f = await fixture(t), replica = await f.replica();
  const identity = {
    assertDatabase(db: typeof f.db) {
      if (db !== f.db) throw new Error('Support and identity must share the exact database adapter.');
    },
    async assertSupport() { throw new HttpError(401, 'Sign in again.'); },
    async assertStaff() { throw new HttpError(401, 'Sign in again.'); },
    async staffRoles() { return []; },
  };
  assert.throws(() => new SupportRequests(replica.db, identity), /exact database adapter/);
  const user = (await f.browser.bootstrap()).user; assert.ok(user);
  await assert.rejects(new SupportRequests(f.db, identity).save(user, command()),
    (error: unknown) => error instanceof HttpError && error.status === 401);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM support').get())?.count, 0);
});

test('owned support pagination includes old owned requests, ties by stable ID, rejects foreign cursors and never adopts email-only contact', async t => {
  const f = await fixture(t), other = f.newBrowser(); await f.complete(other, await f.begin(other), { sub: 'google-oauth2|support-other', email: 'other@example.invalid' });
  assert.ok((await other.bootstrap()).user); const theirs = await save(other);
  const anonymous = f.newBrowser(); await anonymous.bootstrap();
  assert.equal((await anonymous.request('/api/support', { email: 'owner@example.invalid', body })).status, 401);
  assert.equal((await anonymous.request('/api/support/requests')).status, 401);
  await save(f.browser);
  for (let index = 0; index < 22; index++) await f.db.prepare('INSERT INTO support(id,user_id,email,body,created_at) VALUES(?,?,?,?,?)')
    .run(randomUUID(), f.owner, 'legacy@example.invalid', `${body} Legacy ${index}.`, '2026-01-01T00:00:00.000Z');
  const first = await history(f.browser); assert.equal(first.tickets.length, 10); assert.ok(first.nextCursor);
  assert.equal((await other.request(`/api/support/requests?cursor=${first.nextCursor}`)).status, 400);
  const second = await history(f.browser, first.nextCursor); assert.equal(second.tickets.length, 10); assert.ok(second.nextCursor);
  const third = await history(f.browser, second.nextCursor); assert.equal(third.tickets.length, 3); assert.equal(third.nextCursor, null);
  const all = [...first.tickets, ...second.tickets, ...third.tickets];
  assert.equal(new Set(all.map(ticket => ticket.id)).size, 23);
  assert.ok(!all.some(ticket => ticket.id === theirs.id));
  const rows = await f.db.prepare('SELECT id FROM support WHERE user_id=? ORDER BY created_at DESC,id DESC').all(f.owner);
  assert.deepEqual(all.map(ticket => ticket.id), rows.map(row => row.id));
  for (const suffix of ['?cursor=invalid', '?cursor=a%3D', '?cursor=one&cursor=two', '?owner=other']) {
    assert.equal((await f.browser.request(`/api/support/requests${suffix}`)).status, 400);
  }
});

test('pending and restricted owners retain support-only access without acquiring product or staff authority', async t => {
  const f = await fixture(t);
  for (const status of ['pending-verification', 'suspended', 'deletion-pending']) {
    await f.db.prepare('UPDATE managed_accounts SET status=? WHERE user_id=?').run(status, f.owner);
    const saved = await save(f.browser);
    assert.ok((await history(f.browser)).tickets.some(ticket => ticket.id === saved.id));
    assert.equal((await f.browser.request('/api/targets', { company: 'Amazon', role: 'Backend', level: 'Senior', date: '2026-12-01' })).status, 403);
    assert.equal((await f.browser.request('/api/staff/support')).status, 403);
  }
});

test('actual support INSERT followed by security or private-byte changes rolls back the receipt instead of returning saved success', async t => {
  for (const mode of ['epoch', 'session', 'body', 'whitespace']) {
    await t.test(mode, async t => {
      const f = await fixture(t);
      const effect = mode === 'epoch' ? 'UPDATE managed_accounts SET session_epoch=session_epoch+1;' :
        mode === 'session' ? 'DELETE FROM sessions;' : mode === 'whitespace' ? "UPDATE support SET body=' '||body;" :
        "UPDATE support SET body='Changed private support body after actual INSERT.';";
      await f.db.exec(`CREATE SEQUENCE support_insert_witness; CREATE FUNCTION support_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM nextval('support_insert_witness'); ${effect} RETURN NEW; END; $$;
        CREATE TRIGGER support_insert_guard AFTER INSERT ON support FOR EACH ROW EXECUTE FUNCTION support_insert_guard();`);
      const response = await f.browser.request('/api/support', command());
      assert.equal(response.status, ['body','whitespace'].includes(mode) ? 409 : 403);
      assert.equal((await f.db.prepare('SELECT is_called FROM support_insert_witness').get())?.is_called, true);
      assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM support').get())?.count, 0);
      assert.equal((await f.browser.bootstrap()).user?.id, f.owner);
    });
  }
});

test('a revoked session cannot turn an owned retry into a new anonymous contact or read another receipt', async t => {
  const f = await fixture(t), input = command(); await save(f.browser, input);
  await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
  assert.equal((await f.browser.request('/api/support', input)).status, 401);
  assert.equal((await f.browser.request('/api/support/requests')).status, 401);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM support').get())?.count, 1);
});

test('shared support account admission survives replica and network changes, keeps history available, and does not borrow login budgets', async t => {
  const f = await fixture(t), replica = await f.replica();
  for (let index = 0; index < 31; index++) {
    const browser = index % 2 ? f.newBrowser() : replica.browser();
    for (const [name, value] of f.browser.cookies) browser.cookies.set(name, value); browser.csrf = f.browser.csrf;
    const response = await browser.request('/api/support', { ...command(), body: 'short' });
    assert.equal(response.status, index < 30 ? 400 : 429);
    if (index === 30) assert.ok(Number(response.headers.get('retry-after')) >= 1);
  }
  assert.equal((await history(f.browser)).tickets.length, 0);
  assert.equal((await new IdentityLimits(f.db, f.config.identity.clientSecret)
    .consume('network', '198.18.0.88')).allowed, true);
  const other = replica.browser(); await f.complete(other, await f.begin(other), { sub: 'google-oauth2|support-independent', email: 'independent@example.invalid' });
  await other.bootstrap(); assert.equal((await save(other)).delivery, 'not-connected');
  const buckets = await f.db.prepare("SELECT * FROM identity_abuse_buckets WHERE scope LIKE 'support-%'").all();
  assert.ok(buckets.every(row => /^[a-f0-9]{64}$/.test(String(row.fingerprint))));
  assert.ok(!JSON.stringify(buckets).includes('198.18.'));
  assert.ok(!JSON.stringify(buckets).includes('example.invalid'));
});

test('a missing shared support limiter fails closed without affecting saved-history reads', async t => {
  const f = await fixture(t);
  await f.db.exec('ALTER TABLE identity_abuse_buckets RENAME TO unavailable_support_admission');
  const response = await f.browser.request('/api/support', command()); assert.equal(response.status, 503);
  assert.match(String((await response.json()).error), /support protection/);
  assert.equal((await history(f.browser)).tickets.length, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM support').get())?.count, 0);
});

test('support ownership nulling retires replay keys without granting email-based adoption or claiming full privacy erasure', async t => {
  const f = await fixture(t), input = command(), saved = await save(f.browser, input);
  await assert.rejects(f.db.exec('UPDATE support SET request_hash=NULL'), /check constraint|allow only ownership retirement/);
  await f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);
  const row = await f.db.prepare('SELECT * FROM support WHERE id=?').get(saved.id); assert.ok(row);
  assert.equal(row.user_id, null); assert.equal(row.request_key, null); assert.equal(row.request_hash, null);
  assert.equal(row.body, body);
  const other = f.newBrowser(); await f.complete(other, await f.begin(other), { sub: 'google-oauth2|support-after-deletion' }); assert.ok((await other.bootstrap()).user);
  assert.equal((await history(other)).tickets.length, 0);
});

test('MFA support staff claim revision-fenced tickets, publish idempotent in-app replies and expose no staff identity to owners',async t=>{
  const f=await fixture(t),saved=await save(f.browser),staffBrowser=f.newBrowser();
  const signed=await f.complete(staffBrowser,await f.begin(staffBrowser),{
    sub:'google-oauth2|support-operator',email:'operator@example.invalid',amr:['pwd','mfa'],
  });
  assert.equal(signed.headers.get('location'),'/account');
  const staffData=await staffBrowser.bootstrap();assert.ok(staffData.user);
  await appendStaffRole(f.db,{userId:staffData.user.id,role:'support-agent',state:'granted',actorRef:'fixture-bootstrap',
    reason:'Grant bounded support operations for this synthetic acceptance test.',
    endsAt:new Date(Date.now()+86400000).toISOString()});
  const queue=await staffBrowser.request('/api/staff/support');assert.equal(queue.status,200);
  const page=await queue.json(),ticket=page.tickets.find((value:{id:string})=>value.id===saved.id);assert.ok(ticket);
  assert.equal(ticket.status,'open');assert.equal(ticket.revision,0);assert.equal(ticket.assignment,null);
  assert.equal(ticket.ownerAccess,true);
  assert.notEqual(ticket.maskedEmail,saved.email);assert.doesNotMatch(JSON.stringify(ticket),new RegExp(f.owner));
  const reason='Assign this request after reviewing the bounded in-app support queue.';
  const assigned=await staffBrowser.request(`/api/staff/support/${saved.id}`,{revision:0,assignment:'me',reason},'PATCH');
  assert.equal(assigned.status,200);assert.equal((await assigned.json()).revision,1);
  const otherBrowser=f.newBrowser();
  await f.complete(otherBrowser,await f.begin(otherBrowser),{
    sub:'google-oauth2|support-operator-other',email:'operator.other@example.invalid',amr:['pwd','mfa'],
  });
  const otherData=await otherBrowser.bootstrap();assert.ok(otherData.user);
  await appendStaffRole(f.db,{userId:otherData.user.id,role:'support-agent',state:'granted',actorRef:'fixture-bootstrap',
    reason:'Grant a second bounded support role to verify assignment isolation.',
    endsAt:new Date(Date.now()+86400000).toISOString()});
  const otherQueue=await (await otherBrowser.request('/api/staff/support')).json();
  assert.equal(otherQueue.tickets.find((value:{id:string})=>value.id===saved.id).assignment,'other');
  assert.equal((await otherBrowser.request(`/api/staff/support/${saved.id}`,
    {revision:1,status:'resolved',reason:'Reject another support agent changing this assigned request.'},'PATCH')).status,409);
  assert.equal((await otherBrowser.request(`/api/staff/support/${saved.id}/replies`,
    {requestId:randomUUID(),revision:1,body:'This other agent must not publish into an assigned request.'})).status,409);
  assert.equal((await staffBrowser.request(`/api/staff/support/${saved.id}`,
    {revision:0,status:'resolved',reason:'Reject a stale support state transition after assignment.'},'PATCH')).status,409);
  const requestId=randomUUID(),replyBody='We received your request and preserved your saved preparation. Please confirm whether sign-in now succeeds.';
  const first=await staffBrowser.request(`/api/staff/support/${saved.id}/replies`,
    {requestId,revision:1,body:replyBody});
  assert.equal(first.status,201);const firstResult=await first.json(),firstReply=firstResult.reply;
  const replay=await staffBrowser.request(`/api/staff/support/${saved.id}/replies`,
    {requestId,revision:1,body:replyBody});
  assert.equal(replay.status,201);assert.deepEqual(await replay.json(),firstResult);
  assert.equal((await staffBrowser.request(`/api/staff/support/${saved.id}/replies`,
    {requestId,revision:2,body:`${replyBody} Changed.`})).status,409);
  const ownerHistory=await history(f.browser),ownerTicket=ownerHistory.tickets.find(value=>value.id===saved.id);assert.ok(ownerTicket);
  assert.equal(ownerTicket.handlingStatus,'pending');assert.deepEqual(ownerTicket.replies,[firstReply]);
  assert.doesNotMatch(JSON.stringify(ownerTicket),/support-operator|operator@example/);
  const resolved=await staffBrowser.request(`/api/staff/support/${saved.id}`,
    {revision:2,status:'resolved',reason:'Resolve after publishing the reviewed owner-visible response.'},'PATCH');
  assert.equal(resolved.status,200);assert.equal((await resolved.json()).revision,3);
  const events=await f.db.prepare('SELECT action,prior_revision,result_revision FROM support_staff_events WHERE ticket_id=? ORDER BY prior_revision').all(saved.id);
  assert.deepEqual(events.map(value=>value.action),['assigned','replied','status.resolved']);
  assert.deepEqual(events.map(value=>[value.prior_revision,value.result_revision]),[[0,1],[1,2],[2,3]]);
  await assert.rejects(f.db.prepare('UPDATE support_replies SET body=? WHERE id=?').run('Changed immutable reply.',firstReply.id),/append-only/);
  await assert.rejects(f.db.prepare('DELETE FROM support_staff_events WHERE ticket_id=?').run(saved.id),/append-only/);
  const anonymousId=randomUUID();
  await f.db.prepare('INSERT INTO support(id,user_id,email,body,created_at) VALUES(?,NULL,?,?,?)')
    .run(anonymousId,'anonymous@example.invalid','An anonymous request can be triaged but has no authenticated in-app inbox.','2026-10-13T00:00:00.000Z');
  const refreshed=await (await staffBrowser.request('/api/staff/support')).json();
  assert.equal(refreshed.tickets.find((value:{id:string})=>value.id===anonymousId).ownerAccess,false);
  assert.equal((await staffBrowser.request(`/api/staff/support/${anonymousId}/replies`,
    {requestId:randomUUID(),revision:0,body:'This reply must not claim delivery to an unavailable owner inbox.'})).status,409);
});

test('migration 20 preserves actual migration-19 support and admission facts without invented replay keys or delivery', async t => {
  const f = await fixture(t); await save(f.browser);
  assert.ok(f.config.identity);
  await new IdentityLimits(f.db, f.config.identity.clientSecret).consume('network', '198.18.0.199');
  const schema = `support_upgrade_${randomUUID().replaceAll('-', '')}`, url = new URL(f.config.databaseUrl!);
  url.searchParams.set('options', `-c search_path=${schema}`); await f.db.exec(`CREATE SCHEMA "${schema}"`);
  const legacy = postgresConnection(url.href);
  t.after(async () => { try { await legacy.exec(`DROP SCHEMA "${schema}" CASCADE`); } finally { await legacy.close(); } });
  await legacy.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const migration of migrations.filter(migration => migration.version <= 19)) {
    await legacy.exec(migration.sql);
    await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)')
      .run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'));
  }
  for (const table of ['users', 'managed_identities', 'managed_accounts', 'support', 'identity_abuse_buckets']) {
    const columns = (await legacy.prepare('SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position')
      .all(schema, table)).map(row => String(row.column_name));
    assert.ok(columns.length && columns.every(column => /^[a-z_][a-z0-9_]*$/.test(column)));
    await legacy.exec(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.join(',')} FROM "${f.schema}".${table}
      ${table === 'identity_abuse_buckets' ? "WHERE scope NOT LIKE 'support-%'" : ''}`);
  }
  const before = await legacy.prepare('SELECT id,user_id,email,body,created_at FROM support').all();
  const buckets = await legacy.prepare('SELECT * FROM identity_abuse_buckets ORDER BY scope,fingerprint').all();
  const checksums = await legacy.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all();
  await migrateDatabase(legacy); await migrateDatabase(legacy); await assertDatabaseVersion(legacy);
  assert.deepEqual(await legacy.prepare('SELECT id,user_id,email,body,created_at FROM support').all(), before);
  assert.deepEqual(await legacy.prepare('SELECT request_key,request_hash FROM support').all(), [{ request_key: null, request_hash: null }]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM identity_abuse_buckets ORDER BY scope,fingerprint').all(), buckets);
  assert.deepEqual(await legacy.prepare('SELECT version,checksum FROM schema_migrations WHERE version<=19 ORDER BY version').all(), checksums);
  assert.equal((await new IdentityLimits(legacy, f.config.identity.clientSecret).consume('support-account', f.owner)).allowed, true);
});
