import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { CommunityReads } from '../server/community';
import { CommunityContributions } from '../server/community-contributions';
import { CommunityModeration } from '../server/community-moderation';
import { CommunityMutes } from '../server/community-mutes';
import {CommunityBlocks} from '../server/community-blocks';
import { CommunityRestrictions } from '../server/community-restrictions';
import { CommunitySubmissions } from '../server/community-submissions';
import {classifyCommunitySpam,communitySpamTriageVersion} from '../server/community-spam-triage';
import { postgresConnection, type Database } from '../server/db/connection';
import { assertDatabaseVersion, migrateDatabase, migrations } from '../server/db/migrations';
import { HttpError } from '../server/http-error';
import type { StaffIdentityAuthority } from '../server/staff';
import type { CommunityPost } from '../shared/types';
import { communityFeedPath, communityPostApi, communityPostPath, parseStudioAddress } from '../shared/community-routes';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw new Error('TEST_DATABASE_URL must identify a dedicated community PostgreSQL fixture.');
const fields=['author','body','company','createdAt','followed','id','isMine','kind','level','moderated','moderationRevision','region','sample','title','track','voted','votes'].sort();
async function fixture(t:TestContext){
  const root=postgresConnection(databaseUrl!),schema=`community_test_${randomUUID().replaceAll('-','')}`;
  await root.exec(`CREATE SCHEMA ${schema}`);
  const parsed=new URL(databaseUrl!);parsed.searchParams.set('options',`-c search_path=${schema}`);
  const url=parsed.href,db=postgresConnection(url);
  t.after(async()=>{try{await db.close();}finally{try{await root.exec(`DROP SCHEMA ${schema} CASCADE`);}finally{await root.close();}}});
  await migrateDatabase(db);

  const owners=[randomUUID(),randomUUID()];
  for(const owner of owners)await db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,NULL,0)').run(owner,'Synthetic author',`${owner}@example.invalid`);
  const reads=new CommunityReads(db);
  async function add(input:Partial<CommunityPost>&{owner?:string}={}){
    const value={id:randomUUID(),kind:'questions',title:'Synthetic community post',body:'An original fixture post body with enough detail.',
      company:'Fixture Company',track:'system-design',level:'Senior',region:'Global',author:'Synthetic author',
      createdAt:'2026-01-01T00:00:00.000Z',sample:false,...input};
    await db.prepare('INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(value.id,value.kind,value.title,value.body,value.company,value.track,value.level,value.region,value.author,input.owner ?? owners[0],value.createdAt,Number(value.sample));
    return value;
  }
  return {db,url,owners,reads,add};
}
const status=(expected:number)=>(error:unknown)=>error instanceof HttpError&&error.status===expected;
function privateDto(value:CommunityPost,owner:string){
  assert.deepEqual(Object.keys(value).sort(),fields);
  assert.ok(!JSON.stringify(value).includes(owner));
  assert.ok(!Object.hasOwn(value,'authorId'));assert.ok(!Object.hasOwn(value,'author_id'));
}
test('community URL helpers preserve exact bounded data and reject malformed or ambiguous addresses without throwing',()=>{
  for(const id of ['.','..','a/b?c#d%\\e',' padded ','+','%2F','界'.repeat(200)]){
    const post={kind:'submissions' as const,id,track:'legacy/track?x#y\\..'},url=new URL(communityPostPath(post),'https://example.invalid');
    assert.equal(url.pathname,'/community/post');assert.equal(url.searchParams.get('id'),id);assert.equal(url.hash,'');
    assert.deepEqual(parseStudioAddress(url.pathname,url.search).detail,post);
    const api=new URL(communityPostApi(post),'https://example.invalid');assert.equal(api.pathname,'/api/community/post');assert.equal(api.searchParams.get('id'),id);
    const feed=new URL(communityFeedPath(post.kind,post.track),'https://example.invalid');
    assert.equal(feed.pathname,'/community/submissions');assert.equal(parseStudioAddress(feed.pathname,feed.search).track,post.track);
  }
  for(const [path,query] of [['/learn/%',''],['/learn/%E0%A4',''],['/learn/%00',''],['/community/post','?kind=questions&id=%C0%AE'],['/community/post','?kind=questions&id=.&id=..'],['/community/post','?kind=questions&id=.&&actor=not-authority'],['/community/post','?kind=questions'],['/community/post/extra','?kind=questions&id=.'],['/community/submissions','?track=&track=code'],['/community/post',`?kind=questions&id=${'x'.repeat(201)}`]])
    assert.equal(parseStudioAddress(path,query).invalid,true,`${path}${query}`);
  assert.deepEqual(parseStudioAddress('/community/questions/literal%252F','').segments,['community','questions','literal%2F']);
});

test('community spam triage is deterministic, bounded and content-only',()=>{
  const likely=classifyCommunitySpam({title:'LIMITED TIME promo code',body:
    'BUY NOW and contact me on Telegram!!!!!!!! https://one.invalid https://two.invalid https://three.invalid',
    category:'spam',contentRevision:4});
  assert.equal(likely.algorithmVersion,communitySpamTriageVersion);assert.equal(likely.score,100);
  assert.equal(likely.classification,'likely-spam');
  assert.deepEqual(likely.signals,['multiple-links','contact-solicitation','promotional-language','repetitive-content']);
  assert.deepEqual(classifyCommunitySpam({title:null,body:'A normal technical discussion.',category:'other',contentRevision:0}),
    {...classifyCommunitySpam({title:null,body:'A normal technical discussion.',category:'other',contentRevision:0})});
  const bounded=classifyCommunitySpam({title:null,body:'x'.repeat(20_001),category:'other',contentRevision:0});
  assert.equal(bounded.inputTruncated,true);assert.ok(bounded.signals.includes('input-truncated'));
});

test('migrations 21-37 preserve actual legacy community data while adding deletion, moderation and personal-safety state',async t=>{
  const f=await fixture(t),post=await f.add();
  await f.db.prepare('INSERT INTO votes(post_id,user_id) VALUES(?,?)').run(post.id,f.owners[0]);
  await f.db.prepare('INSERT INTO follows(post_id,user_id) VALUES(?,?)').run(post.id,f.owners[1]);
  const schema=`community_upgrade_${randomUUID().replaceAll('-','')}`,url=new URL(f.url!);
  await f.db.exec(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-c search_path=${schema}`);
  const legacy=postgresConnection(url.href);
  t.after(async()=>{try{await legacy.exec(`DROP SCHEMA ${schema} CASCADE`);}finally{await legacy.close();}});
  await legacy.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for(const migration of migrations.filter(migration=>migration.version<=20)){
    await legacy.exec(migration.sql);
    await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)')
      .run(migration.version,migration.name,createHash('sha256').update(migration.sql).digest('hex'));
  }
  const source=await f.db.prepare('SELECT current_schema() AS name').get();assert.ok(typeof source?.name==='string'&&/^[a-z0-9_]+$/.test(source.name));
  for(const table of ['users','posts','votes','follows'])await legacy.exec(`INSERT INTO ${table} SELECT * FROM ${source.name}.${table}`);
  const commentId=randomUUID();
  await legacy.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(commentId,`post/${post.id}`,f.owners[0],'Synthetic author','An original pre-migration comment.','2026-01-01T00:00:00.000Z',null);
  const before=await Promise.all(['posts','votes','follows','comments'].map(table=>legacy.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()));
  const history=await legacy.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  const readIndexes=migrations.find(migration=>migration.version===21);assert.ok(readIndexes);
  await legacy.exec(readIndexes.sql);
  await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)').run(readIndexes.version,readIndexes.name,createHash('sha256').update(readIndexes.sql).digest('hex'));
  const history21=await legacy.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  const postRevisions=migrations.find(migration=>migration.version===22);assert.ok(postRevisions);
  await legacy.exec(postRevisions.sql);
  await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)').run(postRevisions.version,postRevisions.name,createHash('sha256').update(postRevisions.sql).digest('hex'));
  const history22=await legacy.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  const commentRevisions=migrations.find(migration=>migration.version===23);assert.ok(commentRevisions);
  await legacy.exec(commentRevisions.sql);
  await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)').run(commentRevisions.version,commentRevisions.name,createHash('sha256').update(commentRevisions.sql).digest('hex'));
  const history23=await legacy.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  const discussionIndex=migrations.find(migration=>migration.version===24);assert.ok(discussionIndex);
  await legacy.exec(discussionIndex.sql);
  await legacy.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)').run(discussionIndex.version,discussionIndex.name,createHash('sha256').update(discussionIndex.sql).digest('hex'));
  const history24=await legacy.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  await legacy.prepare('UPDATE posts SET title=title WHERE id=?').run(post.id);
  await legacy.prepare('UPDATE comments SET body=body WHERE id=?').run(commentId);
  await assert.rejects(assertDatabaseVersion(legacy),/incompatible/);
  await migrateDatabase(legacy);await migrateDatabase(legacy);await assertDatabaseVersion(legacy);
  assert.deepEqual(await Promise.all(['posts','votes','follows','comments'].map(table=>legacy.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all())),before);
  assert.deepEqual(await legacy.prepare('SELECT version,name,checksum FROM schema_migrations WHERE version<=20 ORDER BY version').all(),history);
  assert.deepEqual(await legacy.prepare('SELECT version,name,checksum FROM schema_migrations WHERE version<=21 ORDER BY version').all(),history21);
  assert.deepEqual(await legacy.prepare('SELECT version,name,checksum FROM schema_migrations WHERE version<=22 ORDER BY version').all(),history22);
  assert.deepEqual(await legacy.prepare('SELECT version,name,checksum FROM schema_migrations WHERE version<=23 ORDER BY version').all(),history23);
  assert.deepEqual(await legacy.prepare('SELECT version,name,checksum FROM schema_migrations WHERE version<=24 ORDER BY version').all(),history24);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_comment_submissions').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_comment_deletions').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_comment_tombstones').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_reports').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_moderation_targets').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_moderation_events').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_spam_triage').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_spam_triage_events').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_appeals').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_appeal_events').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_mutes').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_mute_intents').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_blocks').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_block_intents').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_restrictions').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_restriction_events').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_restriction_appeals').all(),[]);
  assert.deepEqual(await legacy.prepare('SELECT * FROM community_restriction_appeal_events').all(),[]);
  assert.equal((await legacy.prepare(`SELECT is_nullable FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='comments' AND column_name='user_id'`).get())?.is_nullable,'YES');
  assert.equal((await legacy.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(commentId))?.revision,1);
  await legacy.prepare('UPDATE comments SET body=body WHERE id=?').run(commentId);
  assert.equal((await legacy.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(commentId))?.revision,2);
  assert.equal((await legacy.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,1);
  await legacy.prepare('UPDATE posts SET title=? WHERE id=?').run('A controlled original title update',post.id);
  assert.equal((await legacy.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,2);
  const indexes=await legacy.prepare('SELECT indexname FROM pg_indexes WHERE schemaname=?').all(schema);
  for(const name of ['posts_owner_order','posts_created_order','follows_owner','comments_resource_cursor','community_comment_submissions_owner',
    'community_comment_submissions_resource','community_comment_deletions_owner','community_reports_owner_key','community_reports_queue',
    'community_reports_owner_open','community_moderation_events_report','community_appeals_owner_key',
    'community_spam_triage_queue','community_spam_triage_events_report',
    'community_appeals_owner_target_revision','community_appeals_queue','community_appeals_owner_order',
    'community_appeal_events_appeal','community_mutes_owner_state','community_mutes_subject','community_mute_intents_owner_order',
    'community_blocks_owner_state','community_blocks_subject_owner','community_block_intents_owner_order',
    'community_restrictions_active_subject_scope','community_restrictions_subject_order','community_restrictions_staff_queue',
    'community_restriction_events_restriction','community_restriction_appeals_owner_key',
    'community_restriction_appeals_owner_revision','community_restriction_appeals_queue',
    'community_restriction_appeals_owner_order','community_restriction_appeal_events_appeal'])
    assert.ok(indexes.some(row=>row.indexname===name));
  await legacy.prepare(`INSERT INTO identity_abuse_buckets(scope,fingerprint,attempts,started,expires)
    VALUES('community-account',?,1,1,2)`).run('a'.repeat(64));
  assert.equal((await new CommunityReads(legacy).detail(post.id,{kind:'questions'},f.owners[0])).isMine,true);
});

for(const dialect of ['postgres'] as const){
  test(`${dialect}: authenticated reports bind owner, UUID key and exact content without exposing moderation authority`,async t=>{
    const f=await fixture(t),post=await f.add(),moderation=new CommunityModeration(f.db,null);
    const user={id:f.owners[0],name:'Synthetic author',email:`${f.owners[0]}@example.invalid`,demo:false};
    const request={requestId:randomUUID(),targetType:'post' as const,targetId:post.id,category:'privacy' as const,
      details:'This contribution includes a specific private detail that requires moderator review.'};
    let admissions=0;
    const saved=await moderation.report(user,request,async()=>{admissions++;});
    assert.equal(saved.requestId,request.requestId);assert.equal(saved.delivery,'moderation-queue-only');assert.equal(admissions,2);
    const replay=await moderation.report(user,request,async()=>{admissions++;});
    assert.deepEqual(replay,saved);assert.equal(admissions,4);
    await assert.rejects(()=>moderation.report(user,{...request,details:'A different report body reusing the same exact request key is rejected.'},async()=>{}),status(409));
    await assert.rejects(()=>moderation.report(user,{...request,requestId:randomUUID()},async()=>{}),status(409));
    await assert.rejects(()=>moderation.report(user,{...request,requestId:randomUUID(),targetId:randomUUID()},async()=>{}),status(404));
    await assert.rejects(()=>f.db.prepare('UPDATE community_reports SET details=? WHERE id=?').run(
      'Direct tampering must not alter a saved reporter statement.',saved.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_reports WHERE id=?').run(saved.id));
    const row=await f.db.prepare('SELECT reporter_id,assigned_to,state,report_revision FROM community_reports WHERE id=?').get(saved.id);
    assert.equal(row?.reporter_id,user.id);assert.equal(row?.assigned_to,null);assert.equal(row?.state,'open');assert.equal(row?.report_revision,0);
  });

  test(`${dialect}: contribution owners appeal one exact hidden revision and read minimized report and appeal status`,async t=>{
    const f=await fixture(t),post=await f.add(),moderation=new CommunityModeration(f.db,null);
    const owner={id:f.owners[0],name:'Synthetic author',email:`${f.owners[0]}@example.invalid`,demo:false};
    const other={id:f.owners[1],name:'Other member',email:`${f.owners[1]}@example.invalid`,demo:false};
    const reportTarget=await f.add({owner:f.owners[1],title:'Visible report status target'});
    const reportDetails='A concrete policy concern is saved but must not appear in minimized member status.';
    const report=await moderation.report(owner,{requestId:randomUUID(),targetType:'post',targetId:reportTarget.id,
      category:'misinformation',details:reportDetails},async()=>{});
    await f.db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
      VALUES('post',?,'hidden',1,?)`).run(post.id,new Date().toISOString());
    const hidden=await f.reads.detail(post.id,{kind:'questions'},owner.id,true);
    assert.equal(hidden.moderated,true);assert.equal(hidden.moderationRevision,1);
    const input={requestId:randomUUID(),targetType:'post' as const,targetId:post.id,targetRevision:1,
      statement:'The hidden contribution contains original context that should receive a second policy review.'};
    let admissions=0;
    const saved=await moderation.appeal(owner,input,async()=>{admissions++;});
    assert.equal(saved.appealedTargetRevision,1);assert.equal(saved.delivery,'moderation-queue-only');assert.equal(admissions,2);
    assert.deepEqual(await moderation.appeal(owner,input,async()=>{admissions++;}),saved);assert.equal(admissions,4);
    await assert.rejects(()=>moderation.appeal(owner,{...input,statement:'A changed appeal statement cannot reuse the same exact request key.'},async()=>{}),status(409));
    await assert.rejects(()=>moderation.appeal(owner,{...input,requestId:randomUUID()},async()=>{}),status(409));
    await assert.rejects(()=>moderation.appeal(other,{...input,requestId:randomUUID()},async()=>{}),status(404));
    const reports=await moderation.reportHistory(owner,{},async()=>{});
    assert.equal(reports.reports[0]?.id,report.id);assert.ok(!JSON.stringify(reports).includes(reportDetails));
    const appeals=await moderation.appealHistory(owner,{},async()=>{});
    assert.equal(appeals.appeals[0]?.id,saved.id);assert.equal(appeals.appeals[0]?.targetState,'hidden');
    assert.ok(!JSON.stringify(appeals).includes(input.statement));
    await assert.rejects(()=>f.db.prepare('UPDATE community_appeals SET statement=? WHERE id=?')
      .run('Direct appeal statement rewriting must fail.',saved.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_appeals WHERE id=?').run(saved.id));
  });

  test(`${dialect}: personal author mutes are replay-safe, privacy-minimized and filter every contribution until exact unmute`,async t=>{
    const f=await fixture(t),viewer={id:f.owners[0],name:'Viewer',email:`${f.owners[0]}@example.invalid`,demo:false};
    const author=f.owners[1],first=await f.add({owner:author,title:'First muted author post',company:'Muted Company'});
    const second=await f.add({owner:author,title:'Second muted author post',company:'Muted Company'});
    const sample=await f.add({owner:author,title:'Illustrative sample cannot identify a member',sample:true});
    const own=await f.add({owner:viewer.id,title:'Viewer owned post',company:'Visible Company'});
    const resource=`post/${own.id}`,comment=randomUUID();
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(comment,resource,author,'Other author',
      'A live comment from the author who will be muted.','2026-01-02T00:00:00.000Z',null);
    const service=new CommunityMutes(f.db),request={requestId:randomUUID(),muted:true as const,targetType:'post' as const,targetId:first.id};
    let admissions=0;
    const saved=await service.set(viewer,request,async()=>{admissions++;});
    assert.equal(saved.muted,true);assert.equal(saved.revision,1);assert.equal(admissions,2);
    assert.deepEqual(await service.set(viewer,request,async()=>{admissions++;}),saved);assert.equal(admissions,4);
    await assert.rejects(()=>service.set(viewer,{...request,targetId:second.id},async()=>{}),status(409));
    await assert.rejects(()=>service.set(viewer,{requestId:randomUUID(),muted:true,targetType:'post',targetId:own.id},async()=>{}),status(409));
    await assert.rejects(()=>service.set(viewer,{requestId:randomUUID(),muted:true,targetType:'post',targetId:sample.id},async()=>{}),status(404));
    await assert.rejects(()=>service.set(viewer,{requestId:randomUUID(),muted:true,targetType:'post',targetId:randomUUID()},async()=>{}),status(404));
    const history=await service.history(viewer,{},async()=>{});
    assert.equal(history.mutes.length,1);assert.equal(history.mutes[0]?.id,saved.id);
    assert.ok(!JSON.stringify(history).includes(author));assert.ok(!Object.hasOwn(history.mutes[0] ?? {},'subjectId'));
    const feed=await f.reads.feed({kind:'questions'},viewer.id);
    assert.ok(feed.posts.some(value=>value.id===own.id));assert.ok(!feed.posts.some(value=>value.id===first.id||value.id===second.id));
    assert.ok(!feed.companies.includes('Muted Company'));assert.equal(feed.total,1);
    await assert.rejects(()=>f.reads.detail(first.id,{kind:'questions'},viewer.id),status(404));
    const comments=await new CommunityContributions(f.db).comments(resource,viewer.id);
    assert.deepEqual(comments.find(value=>value.id===comment),{id:comment,resource,author:'Muted',
      body:'This comment is hidden because you muted its author.',createdAt:'2026-01-02T00:00:00.000Z',
      parentId:null,isMine:false,deleted:false,moderated:false,moderationRevision:0,muted:true,blocked:false});
    await assert.rejects(()=>new CommunitySubmissions(f.db).create(viewer,
      {requestId:randomUUID(),resource,parentId:comment,body:'A reply cannot target an author muted by this viewer.'},async()=>{}),status(400));
    await assert.rejects(()=>new CommunityModeration(f.db,null).report(viewer,{requestId:randomUUID(),targetType:'comment',
      targetId:comment,category:'other',details:'A muted contribution cannot be reported through a direct API request.'},async()=>{}),status(404));
    await assert.rejects(()=>service.set(viewer,{requestId:randomUUID(),muted:false,muteId:saved.id,revision:2},async()=>{}),status(409));
    const unmuted=await service.set(viewer,{requestId:randomUUID(),muted:false,muteId:saved.id,revision:1},async()=>{});
    assert.equal(unmuted.muted,false);assert.equal(unmuted.revision,2);
    assert.equal((await service.history(viewer,{},async()=>{})).mutes.length,0);
    assert.equal((await f.reads.detail(first.id,{kind:'questions'},viewer.id)).id,first.id);
    assert.equal((await new CommunityContributions(f.db).comments(resource,viewer.id)).find(value=>value.id===comment)?.muted,false);
    const remuted=await service.set(viewer,{requestId:randomUUID(),muted:true,targetType:'comment',targetId:comment},async()=>{});
    assert.equal(remuted.id,saved.id);assert.equal(remuted.revision,3);
    await assert.rejects(()=>f.db.prepare('UPDATE community_mute_intents SET target_id=? WHERE owner_id=?')
      .run('tampered-target',viewer.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_mute_intents WHERE owner_id=?').run(viewer.id));
    await assert.rejects(()=>f.db.prepare(`UPDATE community_mutes SET state='unmuted' WHERE id=?`).run(saved.id));
  });

  test(`${dialect}: spam triage stays non-punitive until one exact authorized human review`,async t=>{
    const f=await fixture(t),reporter={id:f.owners[1],name:'Reporter',email:`${f.owners[1]}@example.invalid`,demo:false};
    const administrator={id:f.owners[0],name:'Administrator',email:`${f.owners[0]}@example.invalid`,demo:false};
    const authority:StaffIdentityAuthority={assertDatabase:candidate=>assert.equal(candidate,f.db),
      assertStaff:async()=>{},staffRoles:async(id:string)=>id===administrator.id?['administrator']:[]};
    const service=new CommunityModeration(f.db,authority);
    const post=await f.add({owner:administrator.id,title:'Limited time promotion',
      body:'BUY NOW with a promo code. Contact me on Telegram!!!!!!!! https://one.invalid https://two.invalid https://three.invalid'});
    const receipt=await service.report(reporter,{requestId:randomUUID(),targetType:'post',targetId:post.id,category:'spam',
      details:'This report identifies repeated promotional links and off-platform contact solicitation.'},async()=>{});
    const stored=await f.db.prepare(`SELECT algorithm_version,input_hash,state,revision,score,classification
      FROM community_spam_triage WHERE report_id=?`).get(receipt.id);
    assert.equal(stored?.algorithm_version,communitySpamTriageVersion);assert.equal(stored?.state,'pending');
    assert.equal(stored?.revision,0);assert.equal(stored?.score,100);assert.equal(stored?.classification,'likely-spam');
    const inputHash=String(stored?.input_hash);assert.match(inputHash,/^[0-9a-f]{64}$/);
    const member=await service.reportHistory(reporter,{},async()=>{});
    assert.equal(member.reports[0]?.id,receipt.id);assert.ok(!Object.hasOwn(member.reports[0]??{},'triage'));
    const legacyPost=await f.add({owner:administrator.id,title:'Pre-migration triage fixture'}),legacyId=randomUUID(),now=new Date().toISOString();
    await f.db.prepare(`INSERT INTO community_reports
      (id,reporter_id,request_key,input_hash,target_type,target_id,category,details,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'other',?,?,?)`)
      .run(legacyId,reporter.id,randomUUID(),'a'.repeat(64),'post',legacyPost.id,
        'A pre-migration report intentionally has no fabricated spam triage snapshot.',now,now);
    const queue=await service.queue(administrator,{}),current=queue.reports.find(value=>value.id===receipt.id),
      legacy=queue.reports.find(value=>value.id===legacyId);
    assert.ok(current?.triage);assert.equal(current.triage.classification,'likely-spam');
    assert.deepEqual(current.triage.signals,['multiple-links','contact-solicitation','promotional-language','repetitive-content']);
    assert.equal(legacy?.triage,null);assert.ok(!JSON.stringify(queue).includes(reporter.id));
    assert.ok(!JSON.stringify(queue).includes(inputHash));
    const moderatorAuthority:StaffIdentityAuthority={assertDatabase:candidate=>assert.equal(candidate,f.db),
      assertStaff:async()=>{},staffRoles:async(id:string)=>id===reporter.id?['moderator']:[]};
    await assert.rejects(()=>new CommunityModeration(f.db,moderatorAuthority).reviewTriage(reporter,receipt.id,{
      revision:0,decision:'confirmed',reason:'A moderator must claim this report before reviewing the automated suggestion.',
    }),status(409));
    const before=await f.db.prepare('SELECT state,assigned_to,report_revision FROM community_reports WHERE id=?').get(receipt.id);
    const decisions=await Promise.allSettled([
      service.reviewTriage(administrator,receipt.id,{revision:0,decision:'confirmed',
        reason:'The bounded signals match the exact contribution, but this review applies no moderation action.'}),
      service.reviewTriage(administrator,receipt.id,{revision:0,decision:'rejected',
        reason:'A competing reviewer rejects the suggestion without changing contribution or account state.'}),
    ]);
    assert.equal(decisions.filter(value=>value.status==='fulfilled').length,1);
    const rejected=decisions.find(value=>value.status==='rejected');assert.ok(rejected?.status==='rejected');
    assert.ok(rejected.reason instanceof HttpError&&rejected.reason.status===409);
    const reviewed=decisions.find(value=>value.status==='fulfilled');assert.ok(reviewed?.status==='fulfilled');
    assert.equal(reviewed.value.triage?.state,'reviewed');assert.equal(reviewed.value.triage?.revision,1);
    assert.deepEqual(await f.db.prepare('SELECT state,assigned_to,report_revision FROM community_reports WHERE id=?').get(receipt.id),before);
    assert.equal(await f.db.prepare('SELECT state FROM community_moderation_targets WHERE target_type=? AND target_id=?')
      .get('post',post.id),undefined);
    assert.equal(Number((await f.db.prepare('SELECT count(*) AS count FROM community_restrictions WHERE source_report_id=?')
      .get(receipt.id))?.count),0);
    const events=await f.db.prepare(`SELECT decision,actor_ref,prior_revision,result_revision
      FROM community_spam_triage_events WHERE report_id=?`).all(receipt.id);
    assert.equal(events.length,1);assert.equal(events[0]?.actor_ref,administrator.id);
    assert.equal(events[0]?.prior_revision,0);assert.equal(events[0]?.result_revision,1);
    const stalePost=await f.add({owner:administrator.id,title:'Editable triage revision fixture'}),stale=await service.report(reporter,{
      requestId:randomUUID(),targetType:'post',targetId:stalePost.id,category:'other',
      details:'This report receives a snapshot before the exact contribution content is edited.',
    },async()=>{});
    await f.db.prepare('UPDATE posts SET body=? WHERE id=?').run(
      'The contribution changed after its bounded spam suggestion was generated.',stalePost.id);
    const staleQueue=(await service.queue(administrator,{})).reports.find(value=>value.id===stale.id);
    assert.equal(staleQueue?.triage?.contentRevision,0);assert.equal(staleQueue?.target.contentRevision,1);
    await assert.rejects(()=>service.reviewTriage(administrator,stale.id,{revision:0,decision:'confirmed',
      reason:'A stale suggestion must not be confirmed while displaying a newer contribution revision.'}),status(409));
    const rejectedStale=await service.reviewTriage(administrator,stale.id,{revision:0,decision:'rejected',
      reason:'Reject the stale suggestion because the contribution changed after generation.'});
    assert.equal(rejectedStale.triage?.outcome,'rejected');assert.equal(rejectedStale.target.contentRevision,1);
    await assert.rejects(()=>f.db.prepare('UPDATE community_spam_triage SET score=0 WHERE report_id=?').run(receipt.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_spam_triage_events WHERE report_id=?').run(receipt.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_spam_triage WHERE report_id=?').run(receipt.id));
  });

  test(`${dialect}: personal account blocks create a private two-way interaction boundary with exact owner recovery`,async t=>{
    const f=await fixture(t),viewer={id:f.owners[0],name:'Viewer',email:`${f.owners[0]}@example.invalid`,demo:false};
    const subject={id:f.owners[1],name:'Subject',email:`${f.owners[1]}@example.invalid`,demo:false};
    const third={id:randomUUID(),name:'Third member',email:'third-block-fixture@example.invalid',demo:false};
    await f.db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,NULL,0)')
      .run(third.id,third.name,third.email);
    const subjectPost=await f.add({owner:subject.id,title:'Subject relationship block post',company:'Blocked Company'});
    const viewerPost=await f.add({owner:viewer.id,title:'Viewer relationship block post',company:'Viewer Company'});
    const sample=await f.add({owner:subject.id,title:'Illustrative block target',sample:true});
    const thirdPost=await f.add({owner:third.id,title:'Neutral discussion for relationship block comments'});
    const resource=`post/${thirdPost.id}`,subjectComment=randomUUID(),viewerComment=randomUUID();
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(subjectComment,resource,subject.id,subject.name,
      'A subject comment that becomes a generic relationship safety tombstone.','2026-01-02T00:00:00.000Z',null);
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(viewerComment,resource,viewer.id,viewer.name,
      'A viewer comment hidden from the subject by the same relationship boundary.','2026-01-03T00:00:00.000Z',null);
    const service=new CommunityBlocks(f.db),request={requestId:randomUUID(),blocked:true as const,
      targetType:'post' as const,targetId:subjectPost.id};
    let admissions=0,blockReady!:()=>void,releaseBlock!:()=>void;
    const ready=new Promise<void>(resolve=>{blockReady=resolve;}),release=new Promise<void>(resolve=>{releaseBlock=resolve;});
    const publishing=f.db.transaction(async()=>{
      const result=await service.set(viewer,request,async()=>{admissions++;});
      blockReady();await release;return result;
    });
    await ready;
    let interactionSettled=false;
    const waiting=f.db.transaction(()=>service.assertAllowed(subject.id,viewer.id));
    void waiting.then(()=>{interactionSettled=true;},()=>{interactionSettled=true;});
    try{
      if(dialect==='postgres'){
        const deadline=Date.now()+5000;
        let blocked=false;
        while(Date.now()<deadline){
          const row=await f.db.prepare(`SELECT count(*) AS count FROM pg_stat_activity
            WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%'`).get();
          if(Number(row?.count)>0){blocked=true;break;}
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.equal(blocked,true,'The direct interaction did not wait on the relationship-pair lock.');
      }else await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(interactionSettled,false);
    }finally{releaseBlock();}
    const saved=await publishing;
    await assert.rejects(()=>waiting,status(404));
    assert.equal(saved.blocked,true);assert.equal(saved.revision,1);assert.equal(admissions,2);
    assert.deepEqual(await service.set(viewer,request,async()=>{admissions++;}),saved);assert.equal(admissions,4);
    await assert.rejects(()=>service.set(viewer,{...request,targetId:randomUUID()},async()=>{}),status(409));
    await assert.rejects(()=>service.set(viewer,{requestId:randomUUID(),blocked:true,targetType:'post',
      targetId:viewerPost.id},async()=>{}),status(409));
    await assert.rejects(()=>service.set(viewer,{requestId:randomUUID(),blocked:true,targetType:'post',
      targetId:sample.id},async()=>{}),status(404));
    const history=await service.history(viewer,{},async()=>{});
    assert.equal(history.blocks.length,1);assert.equal(history.blocks[0]?.id,saved.id);
    assert.ok(!JSON.stringify(history).includes(subject.id));assert.ok(!Object.hasOwn(history.blocks[0]??{},'subjectId'));
    assert.ok(!(await f.reads.feed({kind:'questions'},viewer.id)).posts.some(post=>post.id===subjectPost.id));
    assert.ok(!(await f.reads.feed({kind:'questions'},subject.id)).posts.some(post=>post.id===viewerPost.id));
    assert.ok((await f.reads.feed({kind:'questions'},third.id)).posts.some(post=>post.id===subjectPost.id));
    await assert.rejects(()=>f.reads.detail(subjectPost.id,{kind:'questions'},viewer.id),status(404));
    await assert.rejects(()=>f.reads.detail(viewerPost.id,{kind:'questions'},subject.id),status(404));
    const contributions=new CommunityContributions(f.db);
    const viewerComments=await contributions.comments(resource,viewer.id),subjectComments=await contributions.comments(resource,subject.id);
    assert.deepEqual(viewerComments.find(comment=>comment.id===subjectComment),{
      id:subjectComment,resource,author:'Unavailable',body:'This comment is unavailable due to a personal safety setting.',
      createdAt:'2026-01-02T00:00:00.000Z',parentId:null,isMine:false,deleted:false,moderated:false,
      moderationRevision:0,muted:false,blocked:true,
    });
    assert.equal(subjectComments.find(comment=>comment.id===viewerComment)?.blocked,true);
    assert.equal((await contributions.comments(resource,third.id)).find(comment=>comment.id===subjectComment)?.blocked,false);
    await assert.rejects(()=>service.assertAllowed(viewer.id,subject.id),status(404));
    await assert.rejects(()=>service.assertAllowed(subject.id,viewer.id),status(404));
    await assert.rejects(()=>new CommunitySubmissions(f.db).create(viewer,{requestId:randomUUID(),resource,
      parentId:subjectComment,body:'A direct reply cannot cross an active relationship block.'},async()=>{}),status(404));
    await assert.rejects(()=>new CommunitySubmissions(f.db).create(viewer,{requestId:randomUUID(),
      resource:`post/${subjectPost.id}`,parentId:null,body:'A discussion write cannot cross an active relationship block.'},
      async()=>{}),status(404));
    const reciprocal=await service.set(subject,{requestId:randomUUID(),blocked:true,targetType:'post',
      targetId:viewerPost.id},async()=>{});
    assert.equal(reciprocal.blocked,true);
    await assert.rejects(()=>service.set(viewer,{requestId:randomUUID(),blocked:false,blockId:saved.id,revision:2},
      async()=>{}),status(409));
    const unblocked=await service.set(viewer,{requestId:randomUUID(),blocked:false,blockId:saved.id,revision:1},async()=>{});
    assert.equal(unblocked.blocked,false);assert.equal(unblocked.revision,2);
    assert.equal((await service.history(viewer,{},async()=>{})).blocks.length,0);
    await assert.rejects(()=>f.reads.detail(subjectPost.id,{kind:'questions'},viewer.id),status(404));
    await service.set(subject,{requestId:randomUUID(),blocked:false,blockId:reciprocal.id,revision:1},async()=>{});
    assert.equal((await f.reads.detail(subjectPost.id,{kind:'questions'},viewer.id)).id,subjectPost.id);
    assert.equal((await contributions.comments(resource,viewer.id)).find(comment=>comment.id===subjectComment)?.blocked,false);
    await assert.rejects(()=>f.db.prepare('UPDATE community_block_intents SET target_id=? WHERE owner_id=?')
      .run('tampered-block-target',viewer.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_block_intents WHERE owner_id=?').run(viewer.id));
    await assert.rejects(()=>f.db.prepare(`UPDATE community_blocks SET state='blocked' WHERE id=?`).run(saved.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_blocks WHERE id=?').run(saved.id));
    const cleanupOwner=randomUUID(),cleanupSubject=randomUUID(),cleanupBlock=randomUUID(),cleanupKey=randomUUID(),now=new Date().toISOString();
    for(const id of [cleanupOwner,cleanupSubject])await f.db.prepare(
      'INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,NULL,0)').run(id,'Block cleanup fixture',`${id}@example.invalid`);
    await f.db.prepare(`INSERT INTO community_blocks
      (id,owner_id,subject_id,target_type,target_id,state,revision,created_at,updated_at)
      VALUES(?,?,?,'post','cleanup-target','blocked',1,?,?)`).run(cleanupBlock,cleanupOwner,cleanupSubject,now,now);
    await f.db.prepare(`INSERT INTO community_block_intents
      (owner_id,request_key,input_hash,block_id,target_type,target_id,blocked,prior_revision,result_revision,created_at)
      VALUES(?,?,?,?,'post','cleanup-target',${dialect==='postgres'?'TRUE':'1'},0,1,?)`)
      .run(cleanupOwner,cleanupKey,'e'.repeat(64),cleanupBlock,now);
    await f.db.prepare('DELETE FROM users WHERE id=?').run(cleanupOwner);
    assert.equal(await f.db.prepare('SELECT id FROM community_blocks WHERE id=?').get(cleanupBlock),undefined);
    assert.equal(await f.db.prepare('SELECT block_id FROM community_block_intents WHERE block_id=?').get(cleanupBlock),undefined);
    assert.ok(await f.db.prepare('SELECT id FROM users WHERE id=?').get(cleanupSubject));
    const retainedOwner=randomUUID(),deletedSubject=randomUUID(),subjectBlock=randomUUID(),subjectKey=randomUUID();
    for(const id of [retainedOwner,deletedSubject])await f.db.prepare(
      'INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,NULL,0)').run(id,'Subject cleanup fixture',`${id}@example.invalid`);
    await f.db.prepare(`INSERT INTO community_blocks
      (id,owner_id,subject_id,target_type,target_id,state,revision,created_at,updated_at)
      VALUES(?,?,?,'comment','subject-cleanup-target','blocked',1,?,?)`)
      .run(subjectBlock,retainedOwner,deletedSubject,now,now);
    await f.db.prepare(`INSERT INTO community_block_intents
      (owner_id,request_key,input_hash,block_id,target_type,target_id,blocked,prior_revision,result_revision,created_at)
      VALUES(?,?,?,?,'comment','subject-cleanup-target',${dialect==='postgres'?'TRUE':'1'},0,1,?)`)
      .run(retainedOwner,subjectKey,'f'.repeat(64),subjectBlock,now);
    await f.db.prepare('DELETE FROM users WHERE id=?').run(deletedSubject);
    assert.equal(await f.db.prepare('SELECT id FROM community_blocks WHERE id=?').get(subjectBlock),undefined);
    assert.equal(await f.db.prepare('SELECT block_id FROM community_block_intents WHERE block_id=?').get(subjectBlock),undefined);
    assert.ok(await f.db.prepare('SELECT id FROM users WHERE id=?').get(retainedOwner));
  });

  test(`${dialect}: reviewed community restrictions are narrow, expiring, revision-fenced and privacy-minimized`,async t=>{
    const f=await fixture(t),reporter={id:f.owners[0],name:'Reporter',email:`${f.owners[0]}@example.invalid`,demo:false};
    const author=f.owners[1],post=await f.add({owner:author,title:'Restriction evidence target'});
    const moderation=new CommunityModeration(f.db,null);
    const report=await moderation.report(reporter,{requestId:randomUUID(),targetType:'post',targetId:post.id,
      category:'harassment',details:'A concrete repeated-abuse concern requiring a reviewed scoped restriction.'},async()=>{});
    const staff={id:randomUUID(),name:'Staff reviewer',email:'staff-reviewer@example.invalid',demo:false};
    await f.db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,NULL,0)')
      .run(staff.id,staff.name,staff.email);
    const identity:StaffIdentityAuthority={assertDatabase:candidate=>assert.equal(candidate,f.db),
      assertStaff:async()=>{},staffRoles:async(owner:string)=>owner===staff.id?['administrator']:[]};
    const restrictions=new CommunityRestrictions(f.db,identity);
    const participation=await restrictions.apply(staff,report.id,{reportRevision:0,targetRevision:0,subject:'author',
      scope:'participation',durationHours:24,reason:'Restrict author participation after reviewing the exact report evidence.'});
    assert.equal(participation.scope,'participation');assert.equal(participation.subject,'author');assert.equal(participation.revision,1);
    assert.ok(!JSON.stringify(participation).includes(author));assert.ok(!Object.hasOwn(participation,'subjectId'));
    await assert.rejects(()=>restrictions.assertAllowed(author,'participation'),status(403));
    await restrictions.assertAllowed(author,'reporting');
    const member=await restrictions.status({id:author,name:'Author',email:`${author}@example.invalid`,demo:false});
    assert.equal(member.restrictions.length,1);assert.equal(member.restrictions[0]?.scope,'participation');
    assert.ok(!JSON.stringify(member).includes(report.id));assert.ok(!JSON.stringify(member).includes(staff.id));
    const queue=await restrictions.queue(staff,{});
    assert.equal(queue.restrictions[0]?.id,participation.id);assert.equal(queue.restrictions[0]?.lastActor,'me');
    assert.ok(!JSON.stringify(queue).includes(author));
    await assert.rejects(()=>restrictions.apply(staff,report.id,{reportRevision:0,targetRevision:0,subject:'author',
      scope:'participation',durationHours:24,reason:'A duplicate active restriction must require current-state review.'}),status(409));
    await assert.rejects(()=>restrictions.change(staff,participation.id,{action:'lift',revision:2,
      reason:'A stale restriction revision cannot lift the current reviewed state.'}),status(409));
    const extended=await restrictions.change(staff,participation.id,{action:'extend',revision:1,durationHours:720,
      reason:'Extend the reviewed restriction because the current evidence still requires it.'});
    assert.equal(extended.revision,2);assert.ok(Date.parse(extended.expiresAt)>Date.parse(participation.expiresAt));
    const lifted=await restrictions.change(staff,participation.id,{action:'lift',revision:2,
      reason:'Lift the participation restriction after a separate reviewed resolution.'});
    assert.equal(lifted.status,'lifted');assert.equal(lifted.revision,3);
    await restrictions.assertAllowed(author,'participation');
    assert.equal((await restrictions.status({id:author,name:'Author',email:`${author}@example.invalid`,demo:false})).restrictions.length,0);

    const reporting=await restrictions.apply(staff,report.id,{reportRevision:0,targetRevision:0,subject:'reporter',
      scope:'reporting',durationHours:168,reason:'Restrict new reports after reviewing abuse of the reporting workflow.'});
    assert.equal(reporting.subject,'reporter');await assert.rejects(()=>restrictions.assertAllowed(reporter.id,'reporting'),status(403));
    await restrictions.assertAllowed(reporter.id,'participation');
    const settled=await Promise.allSettled([
      restrictions.apply(staff,report.id,{reportRevision:0,targetRevision:0,subject:'author',scope:'participation',
        durationHours:24,reason:'Issue one current participation restriction after the prior lift.'}),
      restrictions.apply(staff,report.id,{reportRevision:0,targetRevision:0,subject:'author',scope:'participation',
        durationHours:24,reason:'A concurrent duplicate must not create another active restriction.'}),
    ]);
    assert.deepEqual(settled.map(value=>value.status).sort(),['fulfilled','rejected']);
    assert.equal(Number((await f.db.prepare(`SELECT count(*) AS count FROM community_restrictions
      WHERE subject_id=? AND scope='participation' AND state='active'`).get(author))?.count),1);
    assert.deepEqual((await f.db.prepare('SELECT action FROM community_restriction_events WHERE restriction_id=? ORDER BY created_at,id')
      .all(participation.id)).map(value=>value.action),['restrict','extend','lift']);
    await assert.rejects(()=>f.db.prepare('UPDATE community_restriction_events SET reason=? WHERE restriction_id=?')
      .run('Tampering with reviewed restriction evidence must fail.',reporting.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_restrictions WHERE id=?').run(reporting.id));
  });

  test(`${dialect}: restriction appeals bind one exact revision and require independent reviewed lift`,async t=>{
    const f=await fixture(t),owner={id:f.owners[0],name:'Restricted member',email:`${f.owners[0]}@example.invalid`,demo:false};
    const author=f.owners[1],post=await f.add({owner:author,title:'Restriction appeal evidence target'});
    const original={id:randomUUID(),name:'Original moderator',email:'original-moderator@example.invalid',demo:false};
    const reviewer={id:randomUUID(),name:'Independent moderator',email:'independent-moderator@example.invalid',demo:false};
    for(const user of [original,reviewer])await f.db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,NULL,0)')
      .run(user.id,user.name,user.email);
    const identity:StaffIdentityAuthority={assertDatabase:candidate=>assert.equal(candidate,f.db),
      assertStaff:async()=>{},staffRoles:async(id:string)=>
        id===original.id||id===reviewer.id?['moderator']:[]};
    const moderation=new CommunityModeration(f.db,null);
    const report=await moderation.report(owner,{requestId:randomUUID(),targetType:'post',targetId:post.id,
      category:'harassment',details:'A concrete report supports a reviewed restriction and independent appeal rehearsal.'},async()=>{});
    await f.db.prepare(`UPDATE community_reports SET assigned_to=?,report_revision=1,updated_at=?
      WHERE id=? AND report_revision=0`).run(original.id,new Date().toISOString(),report.id);
    const restrictions=new CommunityRestrictions(f.db,identity);
    const restricted=await restrictions.apply(original,report.id,{reportRevision:1,targetRevision:0,subject:'reporter',
      scope:'reporting',durationHours:168,reason:'Restrict report submission after reviewing the exact report evidence.'});
    const input={requestId:randomUUID(),restrictionId:restricted.id,restrictionRevision:1,
      statement:'The reporting restriction should receive an independent review of the cited context.'};
    let admissions=0;
    const appeal=await restrictions.appeal(owner,input,async()=>{admissions++;});
    assert.equal(appeal.appealedRestrictionRevision,1);assert.equal(admissions,2);
    assert.deepEqual(await restrictions.appeal(owner,input,async()=>{admissions++;}),appeal);assert.equal(admissions,4);
    await assert.rejects(()=>restrictions.appeal(owner,{...input,statement:'Different appeal content must not reuse the exact request key.'},async()=>{}),status(409));
    await assert.rejects(()=>restrictions.appeal(owner,{...input,requestId:randomUUID()},async()=>{}),status(409));
    const history=await restrictions.appealHistory(owner,{},async()=>{});
    assert.equal(history.appeals[0]?.status,'open');assert.equal(history.appeals[0]?.scope,'reporting');
    assert.ok(!JSON.stringify(history).includes(input.statement));assert.ok(!JSON.stringify(history).includes(original.id));
    await assert.rejects(()=>f.db.prepare(`UPDATE community_restriction_appeals
      SET state='upheld',appeal_revision=1,updated_at=? WHERE id=?`).run(new Date().toISOString(),appeal.id));
    const queue=await restrictions.appealQueue(original,{});
    assert.equal(queue.appeals[0]?.id,appeal.id);assert.equal(queue.appeals[0]?.restrictionActor,'me');
    assert.ok(!JSON.stringify(queue).includes(owner.id));assert.ok(!Object.hasOwn(queue.appeals[0] ?? {},'ownerId'));
    const claimed=await restrictions.actOnAppeal(original,appeal.id,{revision:0,restrictionRevision:1,action:'claim',
      reason:'Claim this restriction appeal before the independent decision check.'});
    assert.equal(claimed.revision,1);assert.equal(claimed.assignment,'me');
    await assert.rejects(()=>restrictions.actOnAppeal(original,appeal.id,{revision:1,restrictionRevision:1,action:'deny',
      reason:'The original restricting moderator must not decide the same restriction appeal.'}),status(409));
    const released=await restrictions.actOnAppeal(original,appeal.id,{revision:1,restrictionRevision:1,action:'release',
      reason:'Release this appeal so a different moderator can provide the required review.'});
    assert.equal(released.revision,2);assert.equal(released.assignment,null);
    const independentlyClaimed=await restrictions.actOnAppeal(reviewer,appeal.id,
      {revision:2,restrictionRevision:1,action:'claim',
        reason:'Claim this appeal as a moderator independent from the restricting actor.'});
    assert.equal(independentlyClaimed.restrictionActor,'other');
    const upheld=await restrictions.actOnAppeal(reviewer,appeal.id,{revision:3,restrictionRevision:1,action:'uphold',
      reason:'Independent review supports lifting this exact reporting restriction revision.'});
    assert.equal(upheld.status,'upheld');assert.equal(upheld.restrictionState,'lifted');assert.equal(upheld.restrictionRevision,2);
    await restrictions.assertAllowed(owner.id,'reporting');
    assert.deepEqual(await restrictions.appeal(owner,input,async()=>{}),appeal);
    const finalHistory=await restrictions.appealHistory(owner,{},async()=>{});
    assert.equal(finalHistory.appeals[0]?.status,'upheld');assert.equal(finalHistory.appeals[0]?.restrictionState,'lifted');
    assert.deepEqual((await f.db.prepare(`SELECT action FROM community_restriction_appeal_events
      WHERE appeal_id=? ORDER BY created_at,id`).all(appeal.id)).map(value=>value.action),['claim','release','claim','uphold']);
    assert.deepEqual((await f.db.prepare(`SELECT action FROM community_restriction_events
      WHERE restriction_id=? ORDER BY created_at,id`).all(restricted.id)).map(value=>value.action),['restrict','lift']);
    await assert.rejects(()=>f.db.prepare('UPDATE community_restriction_appeals SET statement=? WHERE id=?')
      .run('Direct restriction appeal rewriting must fail.',appeal.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_restriction_appeal_events WHERE appeal_id=?').run(appeal.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_restriction_appeals WHERE id=?').run(appeal.id));

    const second=await restrictions.apply(original,report.id,{reportRevision:1,targetRevision:0,subject:'reporter',
      scope:'reporting',durationHours:24,reason:'Issue a separately reviewed reporting restriction for stale appeal resolution.'});
    const stale=await restrictions.appeal(owner,{requestId:randomUUID(),restrictionId:second.id,restrictionRevision:1,
      statement:'This second restriction appeal will become superseded before a merits decision.'},async()=>{});
    await restrictions.change(original,second.id,{action:'lift',revision:1,
      reason:'Lift this restriction directly before its pending appeal receives review.'});
    await restrictions.actOnAppeal(reviewer,stale.id,{revision:0,restrictionRevision:2,action:'claim',
      reason:'Claim the superseded restriction appeal before recording its resolution.'});
    const resolved=await restrictions.actOnAppeal(reviewer,stale.id,{revision:1,restrictionRevision:2,action:'resolve',
      reason:'Resolve this appeal because the exact appealed restriction revision is no longer current.'});
    assert.equal(resolved.status,'resolved');assert.equal(resolved.restrictionState,'lifted');

    const racingRestriction=await restrictions.apply(original,report.id,{reportRevision:1,targetRevision:0,subject:'reporter',
      scope:'reporting',durationHours:24,reason:'Issue a reviewed reporting restriction for the exact concurrency rehearsal.'});
    const racingAppeal=await restrictions.appeal(owner,{requestId:randomUUID(),restrictionId:racingRestriction.id,
      restrictionRevision:1,statement:'This exact appeal races one reviewed restriction extension.'},async()=>{});
    await restrictions.actOnAppeal(reviewer,racingAppeal.id,{revision:0,restrictionRevision:1,action:'claim',
      reason:'Claim the exact appeal before racing uphold against extension.'});
    const racing=await Promise.allSettled([
      restrictions.actOnAppeal(reviewer,racingAppeal.id,{revision:1,restrictionRevision:1,action:'uphold',
        reason:'Uphold this exact appeal only if the appealed restriction revision remains current.'}),
      restrictions.change(original,racingRestriction.id,{action:'extend',revision:1,durationHours:720,
        reason:'Extend this restriction only if the same current revision remains authoritative.'}),
    ]);
    assert.equal(racing.filter(value=>value.status==='fulfilled').length,1);
    const rejected=racing.find(value=>value.status==='rejected');assert.ok(rejected?.status==='rejected');
    assert.ok(rejected.reason instanceof HttpError&&rejected.reason.status===409);
    const racedAppeal=await f.db.prepare('SELECT state,appeal_revision FROM community_restriction_appeals WHERE id=?')
      .get(racingAppeal.id);
    const racedRestriction=await f.db.prepare('SELECT state,revision FROM community_restrictions WHERE id=?')
      .get(racingRestriction.id);
    if(racedAppeal?.state==='open'){
      assert.equal(racedRestriction?.state,'active');assert.equal(racedRestriction?.revision,2);
      const closed=await restrictions.actOnAppeal(reviewer,racingAppeal.id,
        {revision:1,restrictionRevision:2,action:'resolve',
          reason:'Resolve the concurrency appeal because the reviewed extension won the exact-revision race.'});
      assert.equal(closed.status,'resolved');
    }else{
      assert.equal(racedAppeal?.state,'upheld');assert.equal(racedRestriction?.state,'lifted');
      assert.equal(racedRestriction?.revision,2);
    }
  });

  test(`${dialect}: hidden comments are explicit non-repliable tombstones but remain owner-deletable`,async t=>{
    const f=await fixture(t),post=await f.add(),resource=`post/${post.id}`,parent=randomUUID();
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(parent,resource,f.owners[0],'Synthetic author',
      'A comment that will be hidden by a reviewed moderation action.','2026-01-02T00:00:00.000Z',null);
    await f.db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
      VALUES('comment',?,'hidden',1,?)`).run(parent,new Date().toISOString());
    const contributions=new CommunityContributions(f.db),publicComments=await contributions.comments(resource,f.owners[0]);
    assert.deepEqual(publicComments[0],{id:parent,resource,author:'Moderated',body:'This comment was hidden by moderation.',
    createdAt:'2026-01-02T00:00:00.000Z',parentId:null,isMine:true,deleted:false,moderated:true,moderationRevision:1,
    muted:false,blocked:false});
    await assert.rejects(()=>contributions.updateComment({id:parent,revision:0,body:'Hidden text must not be editable.'},f.owners[0],async()=>{}),status(409));
    const submissions=new CommunitySubmissions(f.db);
    await assert.rejects(()=>submissions.create({id:f.owners[1],name:'Synthetic author'},
      {requestId:randomUUID(),resource,parentId:parent,body:'A new reply cannot target hidden content.'},async()=>{}),status(400));
    const removed=await contributions.removeComment({id:parent,revision:0,requestId:randomUUID()},f.owners[0],async()=>{});
    assert.equal(removed.comment?.deleted,true);assert.equal(removed.comment?.moderated,false);
    assert.equal((await f.db.prepare('SELECT user_id,author,body FROM comments WHERE id=?').get(parent))?.user_id,null);
    const hiddenPost=await f.add({title:'Owner-deletable hidden post'});
    await f.db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
      VALUES('post',?,'hidden',1,?)`).run(hiddenPost.id,new Date().toISOString());
    await assert.rejects(()=>f.reads.detail(hiddenPost.id,{kind:'questions'},null),status(404));
    const ownedHidden=await f.reads.detail(hiddenPost.id,{kind:'questions'},f.owners[0],true);
    assert.equal(ownedHidden.moderated,true);assert.equal(ownedHidden.isMine,true);
    await assert.rejects(()=>contributions.update({id:hiddenPost.id,revision:0,title:'Hidden edits are blocked',
      body:'A hidden post edit with otherwise valid complete body content.'},f.owners[0],async()=>{}),status(409));
    assert.deepEqual(await contributions.remove({id:hiddenPost.id,revision:0},f.owners[0],async()=>{}),{deleted:true});
    await assert.rejects(()=>f.db.prepare(`DELETE FROM community_moderation_targets
      WHERE target_type='post' AND target_id=?`).run(hiddenPost.id));
  });

  if(dialect==='postgres')test('postgres: MFA-authorized moderators claim, hide and restore reports with revision-fenced evidence and global visibility',async t=>{
    const f=await fixture(t),post=await f.add({company:'Hidden Fixture Company'});
    const reporter={id:f.owners[0],name:'Reporter',email:`${f.owners[0]}@example.invalid`,demo:false};
    const moderator={id:f.owners[1],name:'Moderator',email:`${f.owners[1]}@example.invalid`,demo:false};
    const authority:StaffIdentityAuthority={assertDatabase:candidate=>assert.equal(candidate,f.db),
      assertStaff:async()=>{},staffRoles:async(id:string)=>id===moderator.id?['moderator']:[]};
    const service=new CommunityModeration(f.db,authority);
    const receipt=await service.report(reporter,{requestId:randomUUID(),targetType:'post',targetId:post.id,category:'spam',
      details:'This report identifies repeated deceptive promotion in the contribution body.'},async()=>{});
    const queue=await service.queue(moderator,{});
    assert.equal(queue.reports.length,1);assert.equal(queue.reports[0]?.id,receipt.id);
    assert.ok(!JSON.stringify(queue).includes(reporter.id));assert.equal(queue.reports[0]?.targetState,'visible');
    assert.equal(queue.reports[0]?.target.author,'Anonymous');
    const claimed=await service.act(moderator,receipt.id,{revision:0,targetRevision:0,action:'claim',
      reason:'Claiming this report to review the cited deceptive promotion evidence.'});
    assert.equal(claimed.assignment,'me');assert.equal(claimed.revision,1);
    const hidden=await service.act(moderator,receipt.id,{revision:1,targetRevision:0,action:'hide',
      reason:'The reviewed contribution is deceptive promotion and should be hidden.'});
    assert.equal(hidden.targetState,'hidden');assert.equal(hidden.targetRevision,1);assert.equal(hidden.status,'actioned');
    assert.equal((await f.reads.legacy('questions',null)).posts.some(value=>value.id===post.id),false);
    assert.equal((await f.reads.feed({kind:'questions',company:'',level:'',region:'',track:'',q:'',sort:'recent',scope:'all',limit:'20'},null)).companies.includes('Hidden Fixture Company'),false);
    await assert.rejects(()=>f.reads.detail(post.id,{kind:'questions'},null),status(404));
    await assert.rejects(()=>service.act(moderator,receipt.id,{revision:1,targetRevision:0,action:'restore',
      reason:'A stale report and target revision must never restore hidden content.'}),status(409));
    const restored=await service.act(moderator,receipt.id,{revision:2,targetRevision:1,action:'restore',
      reason:'A second review found the hide decision unsupported and restores the contribution.'});
    assert.equal(restored.targetState,'visible');assert.equal(restored.targetRevision,2);
    assert.equal((await f.reads.detail(post.id,{kind:'questions'},null)).id,post.id);
    const events=await f.db.prepare('SELECT action,actor_ref,reason FROM community_moderation_events WHERE report_id=? ORDER BY created_at,id').all(receipt.id);
    assert.deepEqual(events.map(value=>value.action),['claim','hide','restore']);assert.ok(events.every(value=>value.actor_ref===moderator.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_moderation_events WHERE report_id=?').run(receipt.id));
    const concurrentPost=await f.add({title:'Concurrent moderation target'});
    const first=await service.report(reporter,{requestId:randomUUID(),targetType:'post',targetId:concurrentPost.id,category:'spam',
      details:'The first independent report identifies a concrete deceptive-content concern.'},async()=>{});
    const second=await service.report(moderator,{requestId:randomUUID(),targetType:'post',targetId:concurrentPost.id,category:'harassment',
      details:'The second independent report identifies a concrete harassment policy concern.'},async()=>{});
    await service.act(moderator,first.id,{revision:0,targetRevision:0,action:'claim',reason:'Claim the first report before the concurrency rehearsal begins.'});
    await service.act(moderator,second.id,{revision:0,targetRevision:0,action:'claim',reason:'Claim the second report before the concurrency rehearsal begins.'});
    const racing=await Promise.allSettled([
      service.act(moderator,first.id,{revision:1,targetRevision:0,action:'hide',reason:'Apply the first reviewed hide decision with target revision fencing.'}),
      service.act(moderator,second.id,{revision:1,targetRevision:0,action:'hide',reason:'Apply the second reviewed hide decision with target revision fencing.'}),
    ]);
    assert.equal(racing.filter(result=>result.status==='fulfilled').length,1);
    const rejected=racing.find(result=>result.status==='rejected');assert.ok(rejected?.status==='rejected');
    assert.ok(rejected.reason instanceof HttpError&&rejected.reason.status===409);
    const replayTarget=await f.add({title:'Concurrent exact report target'}),requestId=randomUUID();
    const exact={requestId,targetType:'post' as const,targetId:replayTarget.id,category:'privacy' as const,
      details:'Two uncertain callers submit this same exact report key and normalized content.'};
    const [left,right]=await Promise.all([service.report(reporter,exact,async()=>{}),service.report(reporter,exact,async()=>{})]);
    assert.deepEqual(left,right);
    assert.equal(Number((await f.db.prepare('SELECT count(*) AS count FROM community_reports WHERE reporter_id=? AND request_key=?')
      .get(reporter.id,requestId))?.count),1);
  });

  if(dialect==='postgres')test('postgres: MFA-authorized appeal review atomically restores the exact hidden revision with minimized owner status',async t=>{
    const f=await fixture(t),post=await f.add(),owner={id:f.owners[0],name:'Owner',email:`${f.owners[0]}@example.invalid`,demo:false};
    const moderator={id:f.owners[1],name:'Moderator',email:`${f.owners[1]}@example.invalid`,demo:false};
    const authority:StaffIdentityAuthority={assertDatabase:candidate=>assert.equal(candidate,f.db),
      assertStaff:async()=>{},staffRoles:async(id:string)=>id===moderator.id?['moderator']:[]};
    const service=new CommunityModeration(f.db,authority);
    const report=await service.report(moderator,{requestId:randomUUID(),targetType:'post',targetId:post.id,category:'harassment',
      details:'The reviewed contribution contains a concrete harassment concern requiring moderation.'},async()=>{});
    await service.act(moderator,report.id,{revision:0,targetRevision:0,action:'claim',
      reason:'Claim this report before applying the reviewed hide decision.'});
    await service.act(moderator,report.id,{revision:1,targetRevision:0,action:'hide',
      reason:'The cited harassment concern supports hiding this contribution pending appeal.'});
    const statement='The contribution context does not target a person and should receive a second review.';
    const appeal=await service.appeal(owner,{requestId:randomUUID(),targetType:'post',targetId:post.id,targetRevision:1,statement},async()=>{});
    const queue=await service.appealQueue(moderator,{});
    assert.equal(queue.appeals[0]?.id,appeal.id);assert.ok(!JSON.stringify(queue).includes(owner.id));
    const claimed=await service.actOnAppeal(moderator,appeal.id,{revision:0,targetRevision:1,action:'claim',
      reason:'Claim this owner appeal for an independent second policy review.'});
    assert.equal(claimed.assignment,'me');assert.equal(claimed.revision,1);
    await assert.rejects(()=>service.actOnAppeal(moderator,appeal.id,{revision:0,targetRevision:1,action:'uphold',
      reason:'A stale appeal revision must never restore this contribution.'}),status(409));
    const upheld=await service.actOnAppeal(moderator,appeal.id,{revision:1,targetRevision:1,action:'uphold',
      reason:'The second review finds the original hide unsupported and restores the contribution.'});
    assert.equal(upheld.status,'upheld');assert.equal(upheld.targetState,'visible');assert.equal(upheld.targetRevision,2);
    assert.equal((await f.reads.detail(post.id,{kind:'questions'},null)).id,post.id);
    const history=await service.appealHistory(owner,{},async()=>{});
    assert.equal(history.appeals[0]?.status,'upheld');assert.equal(history.appeals[0]?.targetRevision,2);
    assert.ok(!JSON.stringify(history).includes(statement));assert.ok(!JSON.stringify(history).includes(moderator.id));
    const events=await f.db.prepare('SELECT action,actor_ref,reason FROM community_appeal_events WHERE appeal_id=? ORDER BY created_at,id').all(appeal.id);
    assert.deepEqual(events.map(value=>value.action),['claim','uphold']);assert.ok(events.every(value=>value.actor_ref===moderator.id));
    await assert.rejects(()=>f.db.prepare('DELETE FROM community_appeal_events WHERE appeal_id=?').run(appeal.id));
    const deniedPost=await f.add({title:'Appeal denial target'});
    await f.db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
      VALUES('post',?,'hidden',1,?)`).run(deniedPost.id,new Date().toISOString());
    const deniedAppeal=await service.appeal(owner,{requestId:randomUUID(),targetType:'post',targetId:deniedPost.id,targetRevision:1,
      statement:'A second synthetic appeal exercises release and denial without restoring the target.'},async()=>{});
    let denied=await service.actOnAppeal(moderator,deniedAppeal.id,{revision:0,targetRevision:1,action:'claim',
      reason:'Claim the second appeal before rehearsing release and denial behavior.'});
    denied=await service.actOnAppeal(moderator,deniedAppeal.id,{revision:denied.revision,targetRevision:1,action:'release',
      reason:'Release the second appeal so assignment changes remain revision fenced.'});
    denied=await service.actOnAppeal(moderator,deniedAppeal.id,{revision:denied.revision,targetRevision:1,action:'claim',
      reason:'Reclaim the second appeal before recording the final reviewed decision.'});
    denied=await service.actOnAppeal(moderator,deniedAppeal.id,{revision:denied.revision,targetRevision:1,action:'deny',
      reason:'The second review confirms the hide decision and denies this appeal.'});
    assert.equal(denied.status,'denied');assert.equal(denied.targetState,'hidden');assert.equal(denied.targetRevision,1);
    assert.deepEqual((await f.db.prepare('SELECT action FROM community_appeal_events WHERE appeal_id=? ORDER BY created_at,id')
      .all(deniedAppeal.id)).map(value=>value.action),['claim','release','claim','deny']);
  });

  test(`${dialect}: failed receipt insertion rolls back its comment/revision and original-key retry creates once`,async t=>{
    const f=await fixture(t),resource=`lesson/rollback-${randomUUID()}`,user={id:f.owners[0],name:'Synthetic author'};
    let fail=true;
    const db:Database={...f.db,prepare(sql){
      const statement=f.db.prepare(sql);
      return {...statement,run:async(...values)=>{
        if(fail&&sql.startsWith('INSERT INTO community_comment_submissions')){fail=false;throw new Error('Synthetic receipt insertion failure.');}
        return statement.run(...values);
      }};
    }};
    const service=new CommunitySubmissions(db),input={requestId:randomUUID(),resource,body:'A rolled-back comment must not survive without its receipt.'};
    await assert.rejects(service.create(user,input,async()=>{}),/Synthetic receipt insertion failure/);
    assert.deepEqual(await f.db.prepare('SELECT id FROM comments WHERE resource=?').all(resource),[]);
    assert.deepEqual(await f.db.prepare('SELECT comment_id FROM community_comment_revisions').all(),[]);
    assert.deepEqual(await f.db.prepare('SELECT request_id FROM community_comment_submissions').all(),[]);
    const saved=await service.create(user,input,async()=>{}),replay=await service.create(user,input,async()=>{});
    assert.deepEqual(replay,saved);
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get(resource))?.count),1);
    await f.db.prepare('DELETE FROM comments WHERE id=?').run(saved.receipt.commentId);
    assert.equal((await service.read(user.id,{requestId:input.requestId},async()=>{})).comment,null);
    await f.db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    assert.deepEqual(await f.db.prepare('SELECT request_id FROM community_comment_submissions').all(),[]);
  });
  test(`${dialect}: all public post DTOs omit account IDs and derive owned flags without revealing stored question names`,async t=>{
    const f=await fixture(t),[owner,other]=f.owners;
    const question=await f.add({author:'DO NOT PROJECT THIS QUESTION NAME'}),story=await f.add({kind:'stories',owner:other});
    await f.db.prepare('INSERT INTO votes(post_id,user_id) VALUES(?,?)').run(question.id,owner);
    await f.db.prepare('INSERT INTO follows(post_id,user_id) VALUES(?,?)').run(question.id,owner);
    for(const viewer of [owner,other,null]){
      const feed=await f.reads.feed({},viewer),legacy=await f.reads.legacy('questions',viewer),detail=await f.reads.detail(question.id,{kind:'questions'},viewer);
      for(const value of [detail,...legacy.posts,...feed.posts.filter(post=>post.kind==='questions')]){
        privateDto(value,owner);assert.equal(value.author,'Anonymous');assert.equal(value.isMine,viewer===owner);
        assert.equal(value.voted,viewer===owner);assert.equal(value.followed,viewer===owner);
      }
      const shared=await f.reads.detail(story.id,{kind:'stories'},viewer);assert.equal(shared.author,'Synthetic author');assert.equal(shared.isMine,viewer===other);
      privateDto(shared,other);
    }
  });
  test(`${dialect}: bounded literal and Unicode body search, exact filters and personal scopes are server-side`,async t=>{
    const f=await fixture(t),[owner,other]=f.owners;
    const match=await f.add({body:`${'x'.repeat(300)} literal 100%_\\probe Éclair 🙂`,company:'Off-page company'});
    await f.add({owner:other,body:'No wildcard interpretation',company:'Other company',level:'Staff',region:'Europe',track:'code'});
    await f.db.prepare('INSERT INTO follows(post_id,user_id) VALUES(?,?)').run(match.id,other);
    for(const q of ['100%_\\probe','ÉCLAIR','🙂']){
      const feed=await f.reads.feed({q},null);assert.equal(feed.total,1);assert.equal(feed.posts[0].id,match.id);assert.equal(feed.posts[0].body.length,241);
    }
    assert.equal((await f.reads.feed({q:'no-such-text'},null)).total,0);
    assert.equal((await f.reads.feed({kind:'questions',company:'Off-page company',track:'system-design',level:'Senior',region:'Global'},null)).posts[0].id,match.id);
    assert.equal((await f.reads.feed({company:'Off-page'},null)).total,0);
    assert.equal((await f.reads.feed({scope:'mine'},owner)).posts[0].id,match.id);
    assert.equal((await f.reads.feed({scope:'mine'},other)).total,1);
    assert.equal((await f.reads.feed({scope:'following'},other)).posts[0].id,match.id);
    await assert.rejects(f.reads.feed({scope:'mine'},null),status(401));
    await assert.rejects(f.reads.feed({scope:'following'},null),status(401));
    const full=await f.reads.detail(match.id,{kind:'questions'},null);assert.equal(full.body,match.body);
    await assert.rejects(f.reads.detail(match.id,{kind:'stories'},null),status(404));
    await assert.rejects(f.reads.detail(match.id,{kind:'questions',track:'code'},null),status(404));
  });
  test(`${dialect}: recent/popular keyset pages keep ties deterministic and reject changed-query or viewer cursors`,async t=>{
    const f=await fixture(t);
    for(let index=0;index<14;index++)await f.add({id:`tie-${String(index).padStart(2,'0')}`});
    await f.db.prepare('INSERT INTO votes(post_id,user_id) VALUES(?,?)').run('tie-00',f.owners[0]);
    await f.db.prepare('INSERT INTO votes(post_id,user_id) VALUES(?,?)').run('tie-01',f.owners[0]);
    for(const sort of ['recent','popular']){
      const ids:string[]=[];let cursor:string|null=null;
      do{
        const page=await f.reads.feed({kind:'questions',sort,...(cursor?{cursor}:{})},f.owners[0]);
        assert.equal(page.limit,6);assert.equal(page.total,14);assert.ok(page.posts.length<=6);
        ids.push(...page.posts.map(post=>post.id));cursor=page.nextCursor;
      }while(cursor);
      const expected=Array.from({length:14},(_,index)=>`tie-${String(13-index).padStart(2,'0')}`);
      if(sort==='popular')expected.unshift(...expected.splice(12,2));
      assert.deepEqual(ids,expected);assert.equal(new Set(ids).size,14);
    }
    const first=await f.reads.feed({kind:'questions'},f.owners[0]);assert.ok(first.nextCursor);
    const cursor=first.nextCursor;
    for(const change of [{kind:'stories'},{sort:'popular'},{q:'Synthetic'},{company:'Fixture Company'},{level:'Senior'},{region:'Global'},{track:'system-design'},{scope:'mine'},{limit:'20'}])
      await assert.rejects(f.reads.feed({kind:'questions',cursor,...change},f.owners[0]),status(400));
    await assert.rejects(f.reads.feed({kind:'questions',cursor},f.owners[1]),status(400));
    await assert.rejects(f.reads.feed({kind:'questions',cursor},null),status(400));
    await assert.rejects(f.reads.feed({kind:'questions',cursor:`${cursor}=`},f.owners[0]),status(400));
    await assert.rejects(f.reads.feed({cursor:'%%%bad'},f.owners[0]),status(400));
    await assert.rejects(f.reads.feed({cursor:Buffer.from('not JSON').toString('base64url')},null),status(400));
    for(const query of [{kind:'unknown'},{q:['a','b']},{q:'x'.repeat(201)},{q:'bad\0text'},{sort:'random'},{limit:'500'},{limit:'06'},{cursor:''},{authorId:f.owners[0]},{scope:'staff'}])
      await assert.rejects(f.reads.feed(query,null),status(400));
    await assert.rejects(f.reads.detail('missing',{kind:'questions'},null),status(404));
    await assert.rejects(f.reads.detail('missing',{kind:['questions','stories']},null),status(400));
    const legacyId='界'.repeat(200);
    await f.add({id:legacyId,createdAt:'2027-01-01T00:00:00.000Z'});
    for(let index=0;index<5;index++)await f.add({id:`later-${index}`,createdAt:'2028-01-01T00:00:00.000Z'});
    const unicodePage=await f.reads.feed({},null);assert.equal(unicodePage.posts.at(-1)?.id,legacyId);assert.ok(unicodePage.nextCursor);
    assert.ok(unicodePage.nextCursor.length<=2048);
    assert.equal((await f.reads.feed({cursor:unicodePage.nextCursor},null)).posts.length,6);
  });
  test(`${dialect}: old posts remain independently addressable beyond the compatibility feed and company options are bounded, not page-local`,async t=>{
    const f=await fixture(t),old=await f.add({id:'old-question',body:'🙂'.repeat(300),createdAt:'2020-01-01T00:00:00.000Z'});
    await f.db.transaction(async()=>{for(let index=0;index<1005;index++)await f.add({id:`new-${String(index).padStart(4,'0')}`,company:`Company ${String(index%205).padStart(3,'0')}`});});
    const legacy=await f.reads.legacy('questions',null);assert.equal(legacy.posts.length,1000);assert.equal(legacy.truncated,true);
    assert.ok(!legacy.posts.some(post=>post.id===old.id));
    const detail=await f.reads.detail(old.id,{kind:'questions'},null);assert.equal(detail.body,old.body);privateDto(detail,f.owners[0]);
    const feed=await f.reads.feed({kind:'questions',q:'🙂',limit:'50'},null);
    assert.equal(feed.total,1);assert.equal([...feed.posts[0].body].length,241);
    assert.equal(feed.companies.length,200);assert.equal(feed.companyOptionsTruncated,true);assert.equal(feed.nextCursor,null);
    assert.ok(feed.companies.includes('Company 010'));assert.ok(!feed.posts.some(post=>post.company==='Company 010'));
    const limited=await f.reads.feed({kind:'questions',limit:'50'},null);assert.equal(limited.posts.length,50);assert.equal(limited.total,1006);assert.ok(limited.nextCursor);
  });
}
