import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test,type TestContext} from 'node:test';
import {appendStaffRole} from '../server/staff';
import {openIdentityFixture} from './fixtures/identity';

async function fixture(t:TestContext) {
  const value=await openIdentityFixture();
  t.after(()=>value.close());
  return value;
}
async function login(f:Awaited<ReturnType<typeof fixture>>,browser=f.browser(),sub='google-oauth2|staff-owner',email='staff@example.invalid') {
  const response=await f.complete(browser,await f.begin(browser),{sub,email});
  assert.equal(response.headers.get('location'),'/account');
  return {browser,data:await browser.bootstrap()};
}
const reason=(text:string)=>`${text} This reviewed fixture reason is intentionally explicit.`;
const expiry=()=>new Date(Date.now()+7*86400000).toISOString();

test('managed staff administration requires MFA, bounded roles, separation, CAS and atomic audit',async t=>{
  const f=await fixture(t);
  f.setClaims({amr:['pwd']});
  const administrator=await login(f),administratorId=administrator.data.user!.id;
  await appendStaffRole(f.db,{userId:administratorId,role:'administrator',state:'granted',actorRef:'fixture-bootstrap',reason:reason('Grant administrator access.'),endsAt:expiry()});
  await assert.rejects(appendStaffRole(f.db,{userId:administratorId,role:'administrator',state:'revoked',actorRef:'operator@example.invalid',
    reason:reason('Reject contact data as an operator reference.')}),/Invalid string/);
  await assert.rejects(appendStaffRole(f.db,{userId:administratorId,role:'support-agent',state:'granted',actorRef:'fixture-bootstrap',
    reason:reason('Reject an overlong staff grant.'),endsAt:new Date(Date.now()+91*86400000).toISOString()}),/90 days/);
  const visible=await administrator.browser.bootstrap();
  assert.deepEqual(visible.capabilities.staff?.roles,['administrator']);
  assert.equal((await administrator.browser.request('/api/staff/session')).status,403);
  assert.equal((await administrator.browser.security()).sessions[0].mfa,false);

  f.setClaims({amr:['pwd','mfa']});
  await login(f,administrator.browser);
  assert.equal((await administrator.browser.security()).sessions[0].mfa,true);
  const privileged=await administrator.browser.request('/api/staff/session');
  assert.equal(privileged.status,200);
  assert.deepEqual((await privileged.json()).roles,['administrator']);
  const staffToken=createHash('sha256').update(administrator.browser.cookies.get('__Host-studio_session')!).digest('hex');
  await f.db.prepare(`UPDATE managed_sessions SET last_used=floor(extract(epoch from clock_timestamp()-interval '31 minutes')*1000)
    WHERE token=?`).run(staffToken);
  assert.equal((await administrator.browser.request('/api/staff/session')).status,403);
  await f.db.prepare(`UPDATE managed_sessions SET last_used=floor(extract(epoch from clock_timestamp())*1000)
    WHERE token=?`).run(staffToken);
  assert.equal((await administrator.browser.request('/api/staff/session')).status,200);
  await f.db.prepare(`UPDATE managed_sessions SET created_at=floor(extract(epoch from clock_timestamp()-interval '13 hours')*1000) WHERE token=?`).run(staffToken);
  assert.equal((await administrator.browser.request('/api/staff/session')).status,403);
  await f.db.prepare(`UPDATE managed_sessions SET created_at=floor(extract(epoch from clock_timestamp())*1000),
    authenticated_at=floor(extract(epoch from clock_timestamp()-interval '11 minutes')*1000),
    mfa_at=floor(extract(epoch from clock_timestamp()-interval '11 minutes')*1000) WHERE token=?`).run(staffToken);
  assert.equal((await administrator.browser.request('/api/staff/session')).status,403);
  await login(f,administrator.browser);
  assert.equal((await administrator.browser.request('/api/staff/session')).status,200);

  const target=await login(f,f.browser(),'google-oauth2|staff-target','target.person@example.invalid');
  const targetId=target.data.user!.id;
  const lookup=await administrator.browser.request('/api/staff/accounts?'+new URLSearchParams({email:'target.person@example.invalid'}));
  assert.equal(lookup.status,200);
  const account=(await lookup.json()).accounts[0];
  assert.equal(account.id,targetId);assert.equal(account.status,'active');assert.equal(account.revision,0);assert.equal(account.activeSessions,1);
  assert.notEqual(account.maskedEmail,'target.person@example.invalid');
  assert.doesNotMatch(JSON.stringify(account),/target\.person@example\.invalid|name|identity/i);
  assert.equal((await administrator.browser.request('/api/staff/accounts?email=target')).status,400);
  assert.equal((await administrator.browser.request(`/api/staff/accounts/${administratorId}/status`,
    {status:'suspended',revision:0,reason:reason('Attempt self suspension.')},'PATCH')).status,409);

  await f.db.exec(`CREATE FUNCTION reject_fixture_staff_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.reason LIKE 'Reject audit%' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_fixture_staff_audit BEFORE INSERT ON staff_audit_events FOR EACH ROW EXECUTE FUNCTION reject_fixture_staff_audit()`);
  const rejected=await administrator.browser.request(`/api/staff/accounts/${targetId}/status`,
    {status:'suspended',revision:0,reason:reason('Reject audit and rollback mutation.')},'PATCH');
  assert.equal(rejected.status,500);
  assert.deepEqual(await f.db.prepare('SELECT status,admin_revision,session_epoch FROM managed_accounts WHERE user_id=?').get(targetId),
    {status:'active',admin_revision:0,session_epoch:0});
  await f.db.exec('DROP TRIGGER reject_fixture_staff_audit ON staff_audit_events; DROP FUNCTION reject_fixture_staff_audit()');

  const attempts=await Promise.all([
    administrator.browser.request(`/api/staff/accounts/${targetId}/status`,{status:'suspended',revision:0,reason:reason('Suspend after account review A.')},'PATCH'),
    administrator.browser.request(`/api/staff/accounts/${targetId}/status`,{status:'suspended',revision:0,reason:reason('Suspend after account review B.')},'PATCH'),
  ]);
  assert.deepEqual(attempts.map(value=>value.status).sort(),[200,409]);
  const suspended=await (await administrator.browser.request('/api/staff/accounts?'+new URLSearchParams({email:'target.person@example.invalid'}))).json();
  assert.equal(suspended.accounts[0].status,'suspended');assert.equal(suspended.accounts[0].revision,1);assert.equal(suspended.accounts[0].activeSessions,0);
  assert.equal((await target.browser.bootstrap()).user,null);
  const stale=await administrator.browser.request(`/api/staff/accounts/${targetId}/status`,
    {status:'active',revision:0,reason:reason('Stale reactivation must fail.')},'PATCH');
  assert.equal(stale.status,409);
  const reactivated=await administrator.browser.request(`/api/staff/accounts/${targetId}/status`,
    {status:'active',revision:1,reason:reason('Reactivate after reviewed resolution.')},'PATCH');
  assert.equal(reactivated.status,200);
  assert.equal((await reactivated.json()).revision,2);

  const support=await login(f,f.browser(),'google-oauth2|staff-support','support@example.invalid');
  await appendStaffRole(f.db,{userId:support.data.user!.id,role:'support-agent',state:'granted',actorRef:'fixture-bootstrap',
    reason:reason('Grant bounded support lookup.'),endsAt:expiry()});
  assert.equal((await support.browser.request('/api/staff/session')).status,200);
  assert.equal((await support.browser.request('/api/staff/accounts?'+new URLSearchParams({email:'target.person@example.invalid'}))).status,200);
  assert.equal((await support.browser.request(`/api/staff/accounts/${targetId}/status`,
    {status:'suspended',revision:2,reason:reason('Support role must not suspend.')},'PATCH')).status,403);
  assert.equal((await support.browser.request('/api/staff/audit')).status,403);

  await appendStaffRole(f.db,{userId:targetId,role:'support-agent',state:'granted',actorRef:'fixture-bootstrap',
    reason:reason('Protect another staff account.'),endsAt:expiry()});
  assert.equal((await administrator.browser.request(`/api/staff/accounts/${targetId}/status`,
    {status:'suspended',revision:2,reason:reason('Staff status needs separate review.')},'PATCH')).status,409);

  const historyResponse=await administrator.browser.request('/api/staff/audit');
  assert.equal(historyResponse.status,200);
  const history=await historyResponse.json();
  assert.ok(history.events.some((event:{action:string})=>event.action==='account.suspended'));
  assert.ok(history.events.some((event:{action:string})=>event.action==='account.reactivated'));
  assert.equal(history.events.filter((event:{action:string})=>event.action==='account.suspended').length,1);
  assert.doesNotMatch(JSON.stringify(history),/target\.person@example\.invalid|synthetic-owner/);
  const tiedIds=Array.from({length:25},()=>randomUUID());
  for(const id of tiedIds)await f.db.prepare(`INSERT INTO staff_audit_events
    (id,actor_ref,actor_role,target_ref,action,reason,created_at) VALUES(?,?,?,?,?,?,'2999-01-01T00:00:00.123456Z')`)
    .run(id,'fixture-pagination','administrator',targetId,'staff.role.granted',reason('Verify exact audit cursor ties.'));
  const tiedFirst=await (await administrator.browser.request('/api/staff/audit')).json();
  const tiedSecond=await (await administrator.browser.request('/api/staff/audit?'+new URLSearchParams({cursor:tiedFirst.nextCursor}))).json();
  const pagedIds=new Set([...tiedFirst.events,...tiedSecond.events].map((event:{id:string})=>event.id));
  assert.ok(tiedIds.every(id=>pagedIds.has(id)));assert.equal(pagedIds.size,tiedFirst.events.length+tiedSecond.events.length);
  const auditId=history.events[0].id;
  await assert.rejects(f.db.prepare('UPDATE staff_audit_events SET reason=? WHERE id=?').run(reason('Attempt forbidden audit update.'),auditId),/append-only/);
  await assert.rejects(f.db.prepare('UPDATE staff_role_events SET reason=? WHERE user_id=?').run(reason('Attempt forbidden role update.'),administratorId),/append-only/);

  await appendStaffRole(f.db,{userId:administratorId,role:'administrator',state:'revoked',actorRef:'fixture-bootstrap',reason:reason('Revoke administrator access.')});
  assert.equal((await administrator.browser.request('/api/staff/session')).status,403);
  await f.db.prepare(`INSERT INTO staff_role_events(id,user_id,role,state,actor_ref,reason,starts_at,ends_at)
    VALUES(?,?,?,?,?,?,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`)
    .run(randomUUID(),administratorId,'administrator','granted','fixture-bootstrap',reason('Record an expired administrator grant.'));
  assert.equal((await administrator.browser.request('/api/staff/session')).status,403);
  await appendStaffRole(f.db,{userId:administratorId,role:'administrator',state:'granted',actorRef:'fixture-bootstrap',
    reason:reason('Regrant after an expired role.'),endsAt:expiry()});
  assert.equal((await administrator.browser.request('/api/staff/session')).status,200);
});

test('OIDC amr is strictly typed and only explicit mfa evidence is retained',async t=>{
  const f=await fixture(t);
  for(const amr of ['mfa',[''],Array.from({length:21},()=> 'mfa')]){
    const browser=f.browser(),response=await f.complete(browser,await f.begin(browser),{sub:`google-oauth2|amr-${randomUUID()}`,email:'amr@example.invalid',amr});
    assert.equal(response.headers.get('location'),'/auth?error=restart');
    assert.equal((await browser.bootstrap()).user,null);
  }
  f.setClaims({amr:['pwd','otp']});
  const notExplicit=await login(f,f.browser(),'google-oauth2|otp-only','otp@example.invalid');
  assert.equal((await notExplicit.browser.security()).sessions[0].mfa,false);
  f.setClaims({amr:['pwd','mfa']});
  const explicit=await login(f,f.browser(),'google-oauth2|explicit-mfa','mfa@example.invalid');
  assert.equal((await explicit.browser.security()).sessions[0].mfa,true);
});
