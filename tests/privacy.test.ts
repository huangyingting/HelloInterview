import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { StateRepository } from '../server/db/state-repository';
import { Entitlements } from '../server/entitlements';
import { HttpError } from '../server/http-error';
import { TerminalJobFailure } from '../server/jobs';
import type { PrivacyExportHistory } from '../shared/types';
import { openIdentityFixture } from './fixtures/identity';
import { completedPrivacyExport } from './fixtures/privacy';

async function fixture(t:TestContext) {
  const f=await openIdentityFixture();
  t.after(()=>f.close());
  return f;
}
async function login(f:Awaited<ReturnType<typeof fixture>>,browser=f.browser(),sub='google-oauth2|privacy-owner',email='privacy@example.invalid') {
  const response=await f.complete(browser,await f.begin(browser),{sub,email});
  assert.equal(response.headers.get('location'),'/account');
  const data=await browser.bootstrap();
  assert.ok(data.user);
  return {browser,owner:data.user.id};
}

test('privacy exports require fresh owner authority, are idempotent, private, short-lived and immutable',async t=>{
  const f=await fixture(t),owner=await login(f),other=await login(f,f.browser(),'google-oauth2|privacy-other','other@example.invalid');
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=? WHERE id=(SELECT id FROM managed_sessions ORDER BY created_at LIMIT 1)').run(Date.now()-600001);
  assert.equal((await owner.browser.request('/api/privacy/exports',{requestId:randomUUID()})).status,403);
  await login(f,owner.browser);
  const requestId=randomUUID();
  const first=await owner.browser.request('/api/privacy/exports',{requestId});
  const repeat=await owner.browser.request('/api/privacy/exports',{requestId});
  assert.equal(first.status,202);assert.equal(repeat.status,202);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM privacy_exports WHERE id=?').get(requestId))?.count,1);
  const pending=await owner.browser.request('/api/privacy/exports');
  assert.equal((await pending.json() as PrivacyExportHistory).exports[0].status,'requested');
  assert.equal((await other.browser.request(`/api/privacy/exports/${requestId}/download`)).status,404);
  assert.equal((await other.browser.request('/api/privacy/exports',{requestId})).status,202);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM privacy_exports WHERE id=?').get(requestId))?.count,2);

  for(let processed=0;processed<2;processed++){
    const claim=await f.privacy.jobs.claim('privacy.process');
    assert.ok(claim);await f.privacy.runClaim(claim);
  }
  const ready=await owner.browser.request('/api/privacy/exports');
  const item=(await ready.json() as PrivacyExportHistory).exports[0];
  assert.equal(item.status,'ready');assert.ok(item.bytes&&item.bytes>0);assert.match(item.sha256!,/^[a-f0-9]{64}$/);
  const download=await owner.browser.request(`/api/privacy/exports/${requestId}/download`);
  assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')??'',new RegExp(requestId));
  const ownerArtifact=await download.json();
  assert.equal(ownerArtifact.exportId,requestId);
  assert.equal(ownerArtifact.account.profile.id,owner.owner);
  const otherDownload=await other.browser.request(`/api/privacy/exports/${requestId}/download`);
  assert.equal((await otherDownload.json()).account.profile.id,other.owner);
  await assert.rejects(f.db.prepare("UPDATE privacy_exports SET artifact='{}' WHERE id=?").run(requestId),/one publish/);

  const expiredId=randomUUID(),expiredArtifact='{}';
  const expiredOperation=await f.privacy.jobs.enqueue({principal:{type:'user',id:owner.owner},kind:'privacy.process',key:expiredId,
    resource:`privacy-export:${expiredId}`,payload:{exportId:expiredId},retryMode:'idempotent'});
  await f.db.prepare(`INSERT INTO privacy_exports(id,user_id,operation_id,state,requested_at,ready_at,expires_at,artifact,artifact_hash,artifact_bytes)
    SELECT ?,?,?,'ready',clock.at-interval '26 hours',clock.at-interval '25 hours',
      clock.at-interval '1 hour',?,?,? FROM (SELECT clock_timestamp() AS at) clock`).run(expiredId,owner.owner,expiredOperation.id,expiredArtifact,
        createHash('sha256').update(expiredArtifact).digest('hex'),Buffer.byteLength(expiredArtifact));
  assert.equal(await f.privacy.expire(),1);
  assert.equal((await f.privacy.history(owner.owner)).exports.find(value=>value.id===expiredId)?.status,'expired');
  assert.deepEqual(await f.db.prepare('SELECT state,artifact,artifact_hash,artifact_bytes FROM privacy_exports WHERE user_id=? AND id=?').get(owner.owner,expiredId),
    {state:'expired',artifact:null,artifact_hash:null,artifact_bytes:null});
  await assert.rejects(f.privacy.download(owner.owner,expiredId),error=>error instanceof HttpError&&error.status===410);
});

test('privacy artifacts cover owned preparation, identity, grants, usage, contributions, support and billing without bearer secrets',async t=>{
  const f=await fixture(t),{browser,owner}=await login(f);
  await new StateRepository(f.db).mutate(owner,state=>state.stories.push({
    id:'privacy-story',title:'A private owned story',situation:'Situation',task:'Task',action:'Action',result:'Result',tags:['privacy'],
  }));
  await new Entitlements(f.db).issue({
    owner,source:{kind:'engineering',key:'privacy-export-grant'},policy:'premium-read-v1',
    startsAt:Date.now()-1000,endsAt:Date.now()+86300000,
    evidence:{actor:'fixture-operator',reason:'Synthetic privacy export grant evidence.'},
  });
  const supportId=randomUUID();
  await f.db.prepare(`INSERT INTO support(id,user_id,email,body,created_at) VALUES(?,?,?,?,?)`).run(
    supportId,owner,'privacy@example.invalid','A private support request included in the owner export.','2026-10-13T00:00:00.000Z');
  await f.db.prepare(`INSERT INTO support_replies(id,ticket_id,request_key,request_hash,actor_ref,body)
    VALUES(?,?,?,?,?,?)`).run(randomUUID(),supportId,randomUUID(),'7'.repeat(64),'fixture-operator',
      'An owner-visible in-app support reply included without its staff identity.');
  await f.db.prepare(`INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).run('privacy-post','questions','Owned privacy post','A complete private-owner community contribution.','Example','system-design','Senior','Global','Owner',owner,'2026-10-13T00:00:00.000Z');
  await f.db.prepare(`INSERT INTO comments(id,resource,user_id,author,body,created_at,parent_id)
    VALUES(?,?,?,?,?,?,NULL)`).run('privacy-comment','post/privacy-post',owner,'Owner','Owned privacy comment.','2026-10-13T00:00:01.000Z');
  const reportId=randomUUID(),reportKey=randomUUID();
  await f.db.prepare(`INSERT INTO community_reports
    (id,reporter_id,request_key,input_hash,target_type,target_id,category,details,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(reportId,owner,reportKey,'9'.repeat(64),'post','privacy-post','privacy',
      'Owner-submitted private report details included without moderator identity.','2026-10-13T00:00:01.500Z','2026-10-13T00:00:01.500Z');
  await f.db.prepare(`UPDATE community_reports SET assigned_to=?,report_revision=1,updated_at=?
    WHERE id=?`).run(owner,'2026-10-13T00:00:01.600Z',reportId);
  await f.db.prepare(`INSERT INTO community_moderation_events
    (id,report_id,target_type,target_id,actor_ref,actor_role,action,reason,prior_report_revision,result_report_revision,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),reportId,'post','privacy-post','private-moderator-ref','moderator','claim',
      'Private internal moderation reason excluded from the owner export.',0,1,'2026-10-13T00:00:01.600Z');
  await f.db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
    VALUES('post','privacy-post','hidden',1,'2026-10-13T00:00:01.700Z')`).run();
  const appealId=randomUUID(),appealKey=randomUUID();
  await f.db.prepare(`INSERT INTO community_appeals
    (id,owner_id,request_key,input_hash,target_type,target_id,target_revision,statement,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(appealId,owner,appealKey,'a'.repeat(64),'post','privacy-post',1,
      'Owner appeal statement included without private appeal reviewer evidence.','2026-10-13T00:00:01.800Z','2026-10-13T00:00:01.800Z');
  await f.db.prepare(`UPDATE community_appeals SET assigned_to=?,appeal_revision=1,updated_at=? WHERE id=?`)
    .run(owner,'2026-10-13T00:00:01.900Z',appealId);
  await f.db.prepare(`INSERT INTO community_appeal_events
    (id,appeal_id,target_type,target_id,actor_ref,actor_role,action,reason,prior_appeal_revision,result_appeal_revision,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),appealId,'post','privacy-post','private-appeal-moderator','moderator','claim',
      'Private internal appeal reason excluded from the owner export.',0,1,'2026-10-13T00:00:01.900Z');
  await f.db.prepare(`INSERT INTO comments(id,resource,user_id,author,body,created_at,parent_id)
    VALUES(?,?,?,?,?,?,NULL)`).run('privacy-deleted-comment','post/privacy-post',owner,'Owner private name','Removed private comment bytes.','2026-10-13T00:00:02.000Z');
  const deletionKey=randomUUID();
  await f.db.prepare(`INSERT INTO community_comment_deletions
    (user_id,request_id,comment_id,resource,input_hash,prior_revision,result_revision,deleted_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(owner,deletionKey,'privacy-deleted-comment','post/privacy-post','8'.repeat(64),0,1,'2026-10-13T00:00:03.000Z');
  await f.db.prepare('INSERT INTO votes(post_id,user_id) VALUES(?,?)').run('privacy-post',owner);
  await f.db.prepare('INSERT INTO follows(post_id,user_id) VALUES(?,?)').run('privacy-post',owner);

  await f.db.prepare(`INSERT INTO ai_usage_policies(id,payload,request_hash) VALUES(?,?,?)`).run(
    'privacy-usage-policy','{"policy":"synthetic"}','1'.repeat(64));
  await f.db.prepare(`INSERT INTO ai_usage_lineages(id,owner_ref,user_id,anchor,service_start,service_end)
    VALUES(?,?,?,?,?,?)`).run('privacy-lineage',owner,owner,1,1,100000);
  await f.db.prepare(`INSERT INTO ai_usage_windows(id,owner_ref,lineage_id,policy_id,starts_at,ends_at,unit_limit)
    VALUES(?,?,?,?,?,?,?)`).run('privacy-window',owner,'privacy-lineage','privacy-usage-policy',1,100000,10);
  await f.db.prepare(`INSERT INTO ai_usage_reservations(id,owner_ref,user_id,request_key,window_id,policy_id,request_payload,request_hash,units,cost_ceiling)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run('privacy-reservation',owner,owner,'privacy-usage','privacy-window','privacy-usage-policy','{"kind":"tutor"}','2'.repeat(64),1,100);
  await f.db.prepare(`INSERT INTO ai_usage_events(id,reservation_id,owner_ref,action,actor,reason)
    VALUES(?,?,?,?,?,?)`).run('privacy-usage-event','privacy-reservation',owner,'reserved','fixture-operator','Synthetic privacy export usage evidence.');
  await f.db.prepare(`INSERT INTO ai_input_policies(id,payload,request_hash) VALUES(?,?,?)`).run(
    'privacy-input-policy','{"policy":"synthetic"}','3'.repeat(64));
  await f.db.prepare(`INSERT INTO ai_input_snapshots(id,owner_ref,user_id,request_key,request_payload,request_hash,policy_id,
    reservation_id,kind,source_id,source_revision,source_hash,input_hash,payload)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('privacy-input',owner,owner,'privacy-input-key','{"kind":"tutor"}','4'.repeat(64),
      'privacy-input-policy','privacy-reservation','tutor','privacy-source',0,'5'.repeat(64),'6'.repeat(64),'{"prompt":"private export prompt"}');

  const operation=await f.privacy.jobs.enqueue({principal:{type:'user',id:owner},kind:'billing.customer',key:'privacy-billing',
    resource:'privacy-billing-customer',payload:{fixture:true},retryMode:'idempotent'});
  const customerRef=randomUUID();
  await f.db.prepare(`INSERT INTO stripe_owned_customers(id,account_id,user_id,customer_id,state,auth_epoch,operation_id)
    VALUES(?,?,?,?,?,?,?)`).run(customerRef,'acct_privacy',owner,'cus_privacy','mapped',0,operation.id);
  await f.db.prepare(`INSERT INTO stripe_checkout_attempts(id,customer_ref,request_key,offer_key,price_id,origin,auth_epoch,state,
    expires_at,currency,unit_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      randomUUID(),customerRef,'privacy-checkout','pro_monthly','price_privacy','https://studio.fixture',0,'waiting-customer',Date.now()+60000,'usd',1200);
  await f.db.prepare(`INSERT INTO stripe_owned_subscription_ledger(id,customer_ref,account_id,subscription_id,revision,status,payload)
    VALUES(?,?,?,?,?,?,?)`).run(randomUUID(),customerRef,'acct_privacy','sub_privacy',1,'active','{"status":"active"}');
  await f.db.prepare(`INSERT INTO stripe_owned_invoice_ledger(id,customer_ref,account_id,invoice_id,revision,created_at_seconds,status,payload)
    VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),customerRef,'acct_privacy','in_privacy',1,1,'paid','{"status":"paid","amount":1200}');

  const token=[...(await f.db.prepare('SELECT token,csrf_hash FROM managed_sessions').all())][0];
  const exported=await completedPrivacyExport(browser,f.privacy);
  const text=JSON.stringify(exported.artifact);
  assert.match(text,/A private owned story|Owned privacy post|Owned privacy comment|Owner-submitted private report details|Owner appeal statement included|private support request|owner-visible in-app support reply|private export prompt/);
  assert.match(text,new RegExp(deletionKey));
  assert.match(text,new RegExp(reportKey));
  assert.match(text,new RegExp(appealKey));
  assert.doesNotMatch(text,/Removed private comment bytes|Owner private name/);
  assert.match(text,/premium-read-v1|privacy-reservation|pro_monthly|sub_privacy|in_privacy/);
  assert.doesNotMatch(text,new RegExp(String(token.token)));
  assert.doesNotMatch(text,new RegExp(String(token.csrf_hash)));
  assert.doesNotMatch(text,/fixture-operator|private-moderator-ref|Private internal moderation reason|private-appeal-moderator|Private internal appeal reason|assigned_to|request_hash|hosted_url|provider_session_id|job_id/);
  assert.equal((exported.artifact.notices as {scope:string}).scope.includes('does not claim'),true);
});

test('restriction before a privacy worker claim prevents artifact publication',async t=>{
  const f=await fixture(t),{browser,owner}=await login(f),requestId=randomUUID();
  assert.equal((await browser.request('/api/privacy/exports',{requestId})).status,202);
  await f.db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(owner);
  const claim=await f.privacy.jobs.claim('privacy.process');assert.ok(claim);
  await assert.rejects(f.privacy.runClaim(claim),error=>error instanceof TerminalJobFailure&&error.code==='not-eligible');
  assert.equal((await f.db.prepare('SELECT state,artifact FROM privacy_exports WHERE id=?').get(requestId))?.state,'requested');
  assert.equal((await f.db.prepare('SELECT artifact FROM privacy_exports WHERE id=?').get(requestId))?.artifact,null);
});

test('owner deletion enters a restricted cooling-off session, revokes peers and can be freshly cancelled',async t=>{
  const f=await fixture(t),first=await login(f),peer=f.browser();
  await login(f,peer);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM sessions WHERE user_id=?').get(first.owner))?.count,2);
  const exportId=randomUUID();
  assert.equal((await first.browser.request('/api/privacy/exports',{requestId:exportId})).status,202);
  const requestId=randomUUID();
  const requested=await first.browser.request('/api/privacy/deletion',{requestId});
  assert.equal(requested.status,202,await requested.text());
  const after=await first.browser.bootstrap();
  assert.equal(after.user?.identity?.status,'deletion-pending');
  assert.equal((await peer.bootstrap()).user,null);
  const exportClaim=await f.privacy.jobs.claim('privacy.process');assert.ok(exportClaim);
  await assert.rejects(f.privacy.runClaim(exportClaim),error=>error instanceof TerminalJobFailure&&error.code==='not-eligible');
  assert.equal((await f.db.prepare('SELECT artifact FROM privacy_exports WHERE user_id=? AND id=?').get(first.owner,exportId))?.artifact,null);
  const recovery=await login(f,f.browser());
  assert.equal((await recovery.browser.bootstrap()).user?.identity?.status,'deletion-pending');
  assert.equal((await first.browser.request('/api/privacy/deletion')).status,200);
  assert.equal((await first.browser.request('/api/privacy/exports')).status,403);
  const row=await f.db.prepare('SELECT state,operation_id FROM privacy_deletions WHERE user_id=? AND id=?').get(first.owner,requestId);
  assert.deepEqual(row,{state:'cooling-off',operation_id:null});
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=? WHERE token IN (SELECT token FROM sessions WHERE user_id=?)')
    .run(Date.now()-600001,first.owner);
  assert.equal((await first.browser.request('/api/privacy/deletion/cancel',{requestId})).status,403);
  const started=await first.browser.request('/api/identity/reauth',{provider:'google'});
  assert.equal(started.status,200);
  const completed=await f.complete(first.browser,new URL((await started.json() as {url:string}).url),{sub:'google-oauth2|privacy-owner',email:'privacy@example.invalid'});
  assert.equal(completed.headers.get('location'),'/account');
  assert.equal((await first.browser.bootstrap()).user?.identity?.status,'deletion-pending');
  const cancelled=await first.browser.request('/api/privacy/deletion/cancel',{requestId});
  assert.equal(cancelled.status,200);
  assert.equal((await first.browser.bootstrap()).user?.identity?.status,'active');
  assert.equal((await f.db.prepare('SELECT state FROM privacy_deletions WHERE user_id=? AND id=?').get(first.owner,requestId))?.state,'cancelled');
  assert.equal((await f.db.prepare(`SELECT count(*)::integer AS count FROM identity_security_events
    WHERE user_id=? AND action IN ('deletion-requested','deletion-cancelled')`).get(first.owner))?.count,2);
});

test('due deletion work publishes only explicit external blockers and cannot be reopened',async t=>{
  const f=await fixture(t),{owner}=await login(f),deletionId=randomUUID();
  await f.db.transaction(async()=>{
    await f.db.prepare(`UPDATE managed_accounts SET status='deletion-pending',session_epoch=session_epoch+1 WHERE user_id=?`).run(owner);
    await f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner);
    await f.db.prepare(`INSERT INTO privacy_deletions(id,user_id,requested_at,cancel_before)
      SELECT ?,?,clock.at-interval '8 days',clock.at-interval '1 day' FROM (SELECT clock_timestamp() AS at) clock`).run(deletionId,owner);
  });
  assert.equal(await f.privacy.enqueueDueDeletion(),true);
  assert.equal(await f.privacy.enqueueDueDeletion(),false);
  const claim=await f.privacy.jobs.claim('privacy.delete');assert.ok(claim);
  await f.privacy.runDeletionClaim(claim);
  const row=await f.db.prepare('SELECT state,blockers,blocked_at IS NOT NULL AS blocked FROM privacy_deletions WHERE user_id=? AND id=?').get(owner,deletionId);
  assert.equal(row?.state,'blocked');assert.equal(row?.blocked,true);
  assert.deepEqual(row?.blockers,[
    'billing-cancellation-unapproved','processor-erasure-unavailable',
    'retention-policy-unapproved','backup-restore-reconciliation-unavailable',
  ]);
  assert.equal((await f.db.prepare('SELECT status FROM managed_accounts WHERE user_id=?').get(owner))?.status,'deletion-pending');
  assert.ok(await f.db.prepare('SELECT id FROM users WHERE id=?').get(owner));
  await assert.rejects(f.db.prepare(`UPDATE privacy_deletions SET state='cancelled',cancelled_at=clock_timestamp(),
    blocked_at=NULL,blockers='[]'::jsonb WHERE user_id=? AND id=?`).run(owner,deletionId),/timely cancellation/);
});
