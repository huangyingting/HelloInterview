import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { CommunityReads } from '../server/community';
import { CommunitySubmissions } from '../server/community-submissions';
import { localConnection, postgresConnection, type Database } from '../server/db/connection';
import { assertDatabaseVersion, migrateDatabase, migrations } from '../server/db/migrations';
import { HttpError } from '../server/http-error';
import { loadConfig } from '../server/config';
import { startServer } from '../server/runtime';
import { createApp, handleError } from '../server/app';
import type { CommunityPost } from '../shared/types';
import { communityFeedPath, communityPostApi, communityPostPath, parseStudioAddress } from '../shared/community-routes';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw new Error('TEST_DATABASE_URL must identify a dedicated community PostgreSQL fixture.');
const fields=['author','body','company','createdAt','followed','id','isMine','kind','level','region','sample','title','track','voted','votes'].sort();
async function fixture(t:TestContext,dialect:'sqlite'|'postgres'){
  let db:Database,url:string|undefined;
  const parent=path.resolve('data/community-tests');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(path.join(parent,'community-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  if(dialect==='postgres'){
    const root=postgresConnection(databaseUrl!),schema=`community_test_${randomUUID().replaceAll('-','')}`;
    await root.exec(`CREATE SCHEMA ${schema}`);
    const parsed=new URL(databaseUrl!);parsed.searchParams.set('options',`-c search_path=${schema}`);url=parsed.href;
    db=postgresConnection(url);
    t.after(async()=>{try{await db.close();}finally{try{await root.exec(`DROP SCHEMA ${schema} CASCADE`);}finally{await root.close();}}});
    await migrateDatabase(db);
  }else{
    db=localConnection(directory);t.after(()=>db.close());await db.prepare('DELETE FROM posts').run();
  }

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
  return {db,url,directory,owners,reads,add};
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

test('migrations 21-25 preserve actual legacy posts, memberships, comments and immutable history while adding indexes, revisions and empty receipts',async t=>{
  const f=await fixture(t,'postgres'),post=await f.add();
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
  assert.equal((await legacy.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(commentId))?.revision,1);
  await legacy.prepare('UPDATE comments SET body=body WHERE id=?').run(commentId);
  assert.equal((await legacy.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(commentId))?.revision,2);
  assert.equal((await legacy.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,1);
  await legacy.prepare('UPDATE posts SET title=? WHERE id=?').run('A controlled original title update',post.id);
  assert.equal((await legacy.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,2);
  const indexes=await legacy.prepare('SELECT indexname FROM pg_indexes WHERE schemaname=?').all(schema);
  for(const name of ['posts_owner_order','posts_created_order','follows_owner','comments_resource_cursor','community_comment_submissions_owner','community_comment_submissions_resource'])assert.ok(indexes.some(row=>row.indexname===name));
  assert.equal((await new CommunityReads(legacy).detail(post.id,{kind:'questions'},f.owners[0])).isMine,true);
});

test('SQLite upgrades the prior post schema without rewriting saved posts and initializes revisions only once',async t=>{
  const f=await fixture(t,'sqlite'),post=await f.add({id:' exact/legacy SQLite '});
  const before=await f.db.prepare('SELECT * FROM posts WHERE id=?').get(post.id);
  const legacy=new DatabaseSync(path.join(f.directory,'studio.sqlite'));
  try{legacy.exec('DROP TRIGGER initialize_community_post_revision; DROP TRIGGER advance_community_post_revision; DROP TABLE community_post_revisions;');}
  finally{legacy.close();}
  const upgraded=localConnection(f.directory);
  try{
    assert.deepEqual(await upgraded.prepare('SELECT * FROM posts WHERE id=?').get(post.id),before);
    assert.equal((await upgraded.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,0);
    await upgraded.prepare('UPDATE posts SET title=title WHERE id=?').run(post.id);
    assert.equal((await upgraded.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,1);
  }finally{await upgraded.close();}
  const reopened=localConnection(f.directory);
  try{assert.equal((await reopened.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,1);}
  finally{await reopened.close();}
});

test('SQLite adds comment revisions to the prior schema without rewriting comments or resetting positive post versions',async t=>{
  const f=await fixture(t,'sqlite'),post=await f.add(),id=randomUUID();
  await f.db.prepare('UPDATE posts SET title=title WHERE id=?').run(post.id);
  await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,`post/${post.id}`,f.owners[0],'Synthetic author','An original legacy comment before versions.','2026-01-01T00:00:00.000Z',null);
  const before=await f.db.prepare('SELECT * FROM comments WHERE id=?').get(id);
  const legacy=new DatabaseSync(path.join(f.directory,'studio.sqlite'));
  try{legacy.exec('DROP TRIGGER initialize_community_comment_revision; DROP TRIGGER advance_community_comment_revision; DROP TABLE community_comment_revisions;');}
  finally{legacy.close();}
  const upgraded=localConnection(f.directory);
  try{
    assert.deepEqual(await upgraded.prepare('SELECT * FROM comments WHERE id=?').get(id),before);
    assert.equal((await upgraded.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(id))?.revision,0);
    assert.equal((await upgraded.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,1);
  }finally{await upgraded.close();}
});

for(const kind of ['post','comment'] as const)test(`a PostgreSQL owned ${kind} mutation paused before admission cannot commit after the actual browser session is revoked`,async t=>{
  const f=await fixture(t,'postgres');
  let paused=false,enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const db:Database={...f.db,prepare(sql){
    const statement=f.db.prepare(sql);
    return {...statement,get:async(...values)=>{
      if(paused&&sql==='SELECT id FROM users WHERE id=? FOR UPDATE'){paused=false;enter();await gate;}
      return statement.get(...values);
    }};
  }};
  const app=createApp(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,PORT:'0',LOG_REQUESTS:'false'}),db,new AbortController().signal);app.use(handleError);
  const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  const url=`http://127.0.0.1:${address.port}`;
  const login=await fetch(`${url}/api/auth/demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),owner=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const post=await f.add({owner}),id=kind==='post'?post.id:randomUUID();
  if(kind==='comment')await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,`post/${post.id}`,owner,'Synthetic author','A comment that must remain unchanged.','2026-01-01T00:00:00.000Z',null);
  paused=true;
  const updating=fetch(`${url}/api/${kind==='post'?'posts':'comments'}/owned`,{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({id,revision:0,...(kind==='post'?{title:'A revoked session must not edit'}:{}),body:'An edit that should be rejected after session revocation.'})});
  try {
    await Promise.race([entered,updating.then(response=>{throw new Error(`Mutation returned ${response.status} before paused admission.`);})]);
    assert.equal((await fetch(`${url}/api/logout`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,200);
    release();assert.equal((await updating).status,401);
  } finally { release();await updating; }
  assert.equal((await f.db.prepare('SELECT title FROM posts WHERE id=?').get(post.id))?.title,post.title);
  assert.equal((await f.db.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,0);
  if(kind==='comment'){
    assert.equal((await f.db.prepare('SELECT body FROM comments WHERE id=?').get(id))?.body,'A comment that must remain unchanged.');
    assert.equal((await f.db.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(id))?.revision,0);
  }
});

test('PostgreSQL comment creation, durable submission and editing serialize with owner deletion in either admitted order without restoring an orphan discussion',async t=>{
  const f=await fixture(t,'postgres');
  let target='',waitingFor='',first:'comment'|'delete'='comment',enter=()=>{},competingEnter=()=>{},release=()=>{},gate=Promise.resolve();
  const db:Database={...f.db,prepare(sql){
    const statement=f.db.prepare(sql);
    return {...statement,get:async(...values)=>{
      if(values[0]===waitingFor&&((first==='delete'&&sql==='SELECT id FROM posts WHERE id=? FOR UPDATE')||(first==='comment'&&sql.startsWith('SELECT kind FROM posts WHERE id=? AND author_id=? AND sample=0')))){
        waitingFor='';competingEnter();
      }
      const row=await statement.get(...values);
      if(values[0]===target&&((first==='comment'&&sql==='SELECT id FROM posts WHERE id=? FOR UPDATE')||(first==='delete'&&sql.startsWith('SELECT kind FROM posts WHERE id=? AND author_id=? AND sample=0')))){
        target='';enter();await gate;
      }
      return row;
    }};
  }};
  const app=createApp(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,PORT:'0',LOG_REQUESTS:'false'}),db,new AbortController().signal);app.use(handleError);
  const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  const url=`http://127.0.0.1:${address.port}`,api=(route:string,body:unknown,cookie='',method='POST')=>fetch(`${url}${route}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const login=await api('/api/auth/demo',{}),owner=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const other=await api('/api/auth/signup',{name:'Other comment author',email:`${randomUUID()}@example.invalid`,password:'fixture-password-123'});assert.equal(other.status,200);
  const otherOwner=(await other.json()).user.id;
  const otherCookie=other.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  for(const operation of ['create','edit','submit'] as const)for(first of ['comment','delete'] as const){
    const post=await f.add({owner}),resource=`post/${post.id}`;
    const commentId=randomUUID();
    if(operation==='edit')await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(commentId,resource,otherOwner,'Other comment author','An original comment before the racing edit.','2026-01-01T00:00:00.000Z',null);
    const entered=new Promise<void>(resolve=>{enter=resolve;}),competingEntered=new Promise<void>(resolve=>{competingEnter=resolve;});
    gate=new Promise<void>(resolve=>{release=resolve;});target=post.id;waitingFor=post.id;
    const input={requestId:randomUUID(),resource,body:'A durable original comment racing with deletion.'};
    const comment=()=>operation==='submit'?api('/api/comments/submissions',input,otherCookie):operation==='create'?api('/api/comments',{resource,body:'An original comment racing with deletion.'},otherCookie)
      :api('/api/comments/owned',{id:commentId,revision:0,body:'An owned comment edit racing with deletion.'},otherCookie,'PUT');
    const remove=()=>api('/api/posts/owned',{id:post.id,revision:0},cookie,'DELETE');
    const initial=first==='comment'?comment():remove();
    let competing:Promise<Response>|undefined;
    try{
      await Promise.race([entered,initial.then(response=>{throw new Error(`First ${first} returned ${response.status} before locking the post.`);})]);
      competing=first==='comment'?remove():comment();
      await Promise.race([competingEntered,competing.then(response=>{throw new Error(`Competing request returned ${response.status} before attempting the post lock.`);})]);
      release();
      assert.equal((await initial).status,first==='comment'&&operation==='create'?201:200);
      assert.equal((await competing).status,first==='comment'?200:404);
      assert.equal(await f.db.prepare('SELECT id FROM posts WHERE id=?').get(post.id),undefined);
      assert.deepEqual(await f.db.prepare('SELECT id FROM comments WHERE resource=?').all(resource),[]);
      if(operation==='submit'){
        const replay=await api('/api/comments/submissions',input,otherCookie);
        assert.equal(replay.status,first==='comment'?200:404);
        if(first==='comment')assert.equal((await replay.json()).comment,null);
        assert.deepEqual(await f.db.prepare('SELECT id FROM comments WHERE resource=?').all(resource),[]);
      }
    }finally{release();await Promise.allSettled([initial,...(competing?[competing]:[])]);}
  }
});

test('PostgreSQL submission create, replay, receipt and history revalidate a revoked actual session after paused user admission for post and generic discussions',async t=>{
  const f=await fixture(t,'postgres');
  let paused=false,enter=()=>{},release=()=>{},gate=Promise.resolve();
  const db:Database={...f.db,prepare(sql){
    const statement=f.db.prepare(sql);
    return {...statement,get:async(...values)=>{
      if(paused&&sql==='SELECT id FROM users WHERE id=? FOR UPDATE'){paused=false;enter();await gate;}
      return statement.get(...values);
    }};
  }};
  const app=createApp(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,PORT:'0',LOG_REQUESTS:'false'}),db,new AbortController().signal);app.use(handleError);
  const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  const url=`http://127.0.0.1:${address.port}`,api=(route:string,body?:unknown,cookie='')=>fetch(`${url}${route}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  for(const kind of ['post','generic'] as const)for(const operation of ['create','replay','receipt','history'] as const){
    const login=await api('/api/auth/demo',{}),owner=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const resource=kind==='post'?`post/${(await f.add({owner})).id}`:`lesson/admission-${randomUUID()}`;
    const input={requestId:randomUUID(),resource,body:'Only an admitted current session can access this submission.'};
    if(operation!=='create')assert.equal((await api('/api/comments/submissions',input,cookie)).status,200);
    const count=operation==='create'?0:1;
    const entered=new Promise<void>(resolve=>{enter=resolve;});gate=new Promise<void>(resolve=>{release=resolve;});paused=true;
    const reading=operation==='receipt'?api(`/api/comments/submissions/receipt?${new URLSearchParams({requestId:input.requestId})}`,undefined,cookie)
      :operation==='history'?api(`/api/comments/submissions?${new URLSearchParams({resource})}`,undefined,cookie)
      :api('/api/comments/submissions',input,cookie);
    try{
      await Promise.race([entered,reading.then(response=>{throw new Error(`${kind}/${operation} returned ${response.status} before paused admission.`);})]);
      assert.equal((await api('/api/logout',{},cookie)).status,200);
      release();assert.equal((await reading).status,401,`${kind}/${operation}`);
    }finally{release();await reading;}
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get(resource))?.count),count);
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM community_comment_submissions WHERE user_id=? AND request_id=?').get(owner,input.requestId))?.count),count);
  }
});

test('a PostgreSQL comment edit waiting on a privileged row update reads the new revision after the comment lock',async t=>{
  const f=await fixture(t,'postgres'),raw=postgresConnection(f.url!);t.after(()=>raw.close());
  let target='',waitingPid=0,entered=()=>{},release=()=>{},ready=()=>{};
  const rowRequested=new Promise<void>(resolve=>{entered=resolve;}),locked=new Promise<void>(resolve=>{ready=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const db:Database={...f.db,prepare(sql){
    const statement=f.db.prepare(sql);
    return {...statement,get:async(...values)=>{
      if(values[0]===target&&sql.includes('FROM comments WHERE id=? AND user_id=?')&&sql.includes('FOR UPDATE')){
        const process=await f.db.prepare('SELECT pg_backend_pid() AS pid').get();assert.equal(typeof process?.pid,'number');
        waitingPid=Number(process!.pid);target='';entered();
      }
      return statement.get(...values);
    }};
  }};
  const app=createApp(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,PORT:'0',LOG_REQUESTS:'false'}),db,new AbortController().signal);app.use(handleError);
  const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  const url=`http://127.0.0.1:${address.port}`;
  const login=await fetch(`${url}/api/auth/demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),owner=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const post=await f.add({owner}),id=randomUUID();
  await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,`post/${post.id}`,owner,'Synthetic author','Original row before external edit.','2026-01-01T00:00:00.000Z',null);
  const changing=raw.transaction(async()=>{await raw.prepare('UPDATE comments SET body=? WHERE id=?').run('A newer privileged saved version.',id);ready();await gate;});
  let editing:Promise<Response>|undefined;
  try{
    await Promise.race([locked,changing.then(()=>{throw new Error('External transaction ended before taking the comment lock.');})]);
    target=id;
    editing=fetch(`${url}/api/comments/owned`,{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({id,revision:0,body:'A stale waiting draft must not win.'})});
    await Promise.race([rowRequested,editing.then(response=>{throw new Error(`Edit returned ${response.status} before requesting the comment lock.`);})]);
    let blocked=false;
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      blocked=(await f.db.prepare('SELECT wait_event_type FROM pg_stat_activity WHERE pid=?').get(waitingPid))?.wait_event_type==='Lock';
      if(blocked)break;await delay(20);
    }
    assert.equal(blocked,true,'The edit must actually wait for the privileged comment-row lock.');
    release();await changing;assert.equal((await editing).status,409);
    assert.equal((await f.db.prepare('SELECT body FROM comments WHERE id=?').get(id))?.body,'A newer privileged saved version.');
    assert.equal((await f.db.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(id))?.revision,1);
  }finally{release();await Promise.allSettled([changing,...(editing?[editing]:[])]);}
});

for(const dialect of ['sqlite','postgres'] as const){
  test(`${dialect}: failed receipt insertion rolls back its comment/revision and original-key retry creates once`,async t=>{
    const f=await fixture(t,dialect),resource=`lesson/rollback-${randomUUID()}`,user={id:f.owners[0],name:'Synthetic author'};
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
    await f.db.prepare('UPDATE comments SET created_at=? WHERE id=?').run('2001-01-01T00:00:00.000Z',saved.receipt.commentId);
    assert.equal((await service.read(user.id,{requestId:input.requestId},async()=>{})).comment,null);
    await f.db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    assert.deepEqual(await f.db.prepare('SELECT request_id FROM community_comment_submissions').all(),[]);
  });
  test(`${dialect}: durable local comment submissions bind actor, key and original input without retaining text or recreating removed comments`,async t=>{
    const f=await fixture(t,dialect),server=await startServer(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,...(f.url?{DATABASE_URL:f.url}:{}),PORT:'0',LOG_REQUESTS:'false'}));t.after(()=>server.close());
    const api=async(route:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST')=>fetch(`${server.url}${route}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const login=await api('/api/auth/demo',{}),owner=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const other=await api('/api/auth/signup',{name:'Other receipt owner',email:`${randomUUID()}@example.invalid`,password:'fixture-password-123'}),otherCookie=other.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const post=await f.add({owner}),resource=`post/${post.id}`,input={requestId:randomUUID(),resource,body:'Original private receipt input must not be copied into the receipt ledger.',parentId:null};
    const route='/api/comments/submissions',lookup=(requestId:string)=>`${route}/receipt?${new URLSearchParams({requestId})}`;
    assert.equal((await api(route,input)).status,401);assert.equal((await api(lookup(input.requestId))).status,401);
    const responses=await Promise.all(Array.from({length:5},()=>api(route,input,cookie)));
    for(const response of responses)assert.equal(response.status,200);
    const saved=await responses[0].json();for(const response of responses.slice(1))assert.deepEqual(await response.json(),saved);
    assert.deepEqual(Object.keys(saved).sort(),['comment','receipt']);assert.deepEqual(Object.keys(saved.receipt).sort(),['commentId','createdAt','requestId','resource','status'].sort());
    assert.equal(saved.receipt.status,'created');assert.equal(saved.receipt.commentId,saved.comment.id);assert.equal(saved.comment.isMine,true);
    assert.ok(!JSON.stringify(saved).includes(owner));assert.ok(!Object.hasOwn(saved.receipt,'input_hash'));
    const stored=await f.db.prepare('SELECT * FROM community_comment_submissions WHERE user_id=? AND request_id=?').get(owner,input.requestId);
    assert.ok(stored);assert.ok(!JSON.stringify(stored).includes(input.body));assert.deepEqual(Object.keys(stored).sort(),['user_id','request_id','comment_id','resource','input_hash','created_at'].sort());
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get(resource))?.count),1);
    assert.deepEqual(await(await api(route,{...input,requestId:input.requestId.toUpperCase(),body:`  ${input.body}\n`},cookie)).json(),saved);
    assert.equal((await api(lookup(input.requestId),undefined,otherCookie)).status,404);
    for(const changed of [{body:'Different original content is not a retry.'},{resource:'lesson/elsewhere'},{parentId:saved.comment.id}]){
      assert.equal((await api(route,{...input,...changed},cookie)).status,409);
    }
    for(const changed of [{owner},{author:'Forged'},{requestId:'bad-key'},{body:'\0invalid text'},{body:'\ud800invalid text'},{resource:'lesson/\ud800'},{parentId:false},{parentId:'\ud800'}])
      assert.equal((await api(route,{...input,...changed},cookie)).status,400);
    assert.equal((await api(lookup(input.requestId)+'&owner=forged',undefined,cookie)).status,400);
    await assert.rejects(f.db.prepare('UPDATE community_comment_submissions SET input_hash=input_hash WHERE user_id=? AND request_id=?').run(owner,input.requestId),/immutable/);
    const edited=await api('/api/comments/owned',{id:saved.comment.id,revision:0,body:'Current text can change; the submission fingerprint stays original.'},cookie,'PUT');assert.equal(edited.status,200);
    const replay=await(await api(route,input,cookie)).json();assert.deepEqual(replay.receipt,saved.receipt);assert.equal(replay.comment.body,'Current text can change; the submission fingerprint stays original.');
    const independent=await api(route,input,otherCookie);assert.equal(independent.status,200);assert.notEqual((await independent.json()).comment.id,saved.comment.id);
    assert.equal((await api('/api/posts/owned',{id:post.id,revision:0},cookie,'DELETE')).status,200);
    const unavailable=await(await api(route,input,cookie)).json();assert.deepEqual(unavailable,{receipt:saved.receipt,comment:null});
    assert.deepEqual(await(await api(lookup(input.requestId),undefined,cookie)).json(),unavailable);
    assert.deepEqual(await f.db.prepare('SELECT id FROM comments WHERE resource=?').all(resource),[]);
    assert.equal((await api(route,{...input,requestId:randomUUID()},cookie)).status,404);
    const history=await(await api(`${route}?${new URLSearchParams({resource})}`,undefined,cookie)).json();assert.deepEqual(history,{submissions:[unavailable],nextCursor:null});
    const legacyResource='lesson/legacy-no-receipts';
    for(let i=0;i<2;i++)assert.equal((await api('/api/comments',{resource:legacyResource,body:'Legacy no-key behavior remains compatible.'},cookie)).status,201);
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get(legacyResource))?.count),2);
    assert.deepEqual(await(await api(`${route}?${new URLSearchParams({resource:legacyResource})}`,undefined,cookie)).json(),{submissions:[],nextCursor:null});
  });
  test(`${dialect}: private comment submission histories are bounded, viewer/resource-bound and survive restart with minimal references`,async t=>{
    const f=await fixture(t,dialect),config=loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,...(f.url?{DATABASE_URL:f.url}:{}),PORT:'0',LOG_REQUESTS:'false'}),server=await startServer(config);t.after(()=>server.close());
    const login=await fetch(`${server.url}/api/auth/demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),owner=(await login.json()).user.id;
    const headers={Cookie:cookie,'Content-Type':'application/json'},resource='lesson/receipt-history',keys:string[]=[];
    for(let i=0;i<23;i++){
      const requestId=randomUUID();keys.push(requestId);
      const response=await fetch(`${server.url}/api/comments/submissions`,{method:'POST',headers,body:JSON.stringify({requestId,resource,body:`Original history input ${i}.`})});assert.equal(response.status,200);
    }
    const first=await(await fetch(`${server.url}/api/comments/submissions?${new URLSearchParams({resource})}`,{headers})).json();
    assert.equal(first.submissions.length,10);assert.ok(first.nextCursor);assert.ok(!Buffer.from(first.nextCursor,'base64url').toString('utf8').includes(owner));
    const ids=first.submissions.map((value:{receipt:{requestId:string}})=>value.receipt.requestId);let cursor=first.nextCursor,pages=1;
    while(cursor){assert.ok(pages++<5);const page=await(await fetch(`${server.url}/api/comments/submissions?${new URLSearchParams({resource,cursor})}`,{headers})).json();assert.ok(page.submissions.length<=10);ids.push(...page.submissions.map((value:{receipt:{requestId:string}})=>value.receipt.requestId));cursor=page.nextCursor;}
    assert.deepEqual([...ids].sort(),keys.sort());assert.equal(new Set(ids).size,23);
    const invalidQueries:Record<string,string>[]=[{resource:'lesson/other',cursor:first.nextCursor},{resource,cursor:'%'},{resource,owner},{resource,limit:'100'}];
    for(const query of invalidQueries)
      assert.equal((await fetch(`${server.url}/api/comments/submissions?${new URLSearchParams(query)}`,{headers})).status,400);
    await server.close();const restarted=await startServer(config);t.after(()=>restarted.close());
    const retained=await fetch(`${restarted.url}/api/comments/submissions/receipt?${new URLSearchParams({requestId:keys[0]})}`,{headers});assert.equal(retained.status,200);assert.equal((await retained.json()).receipt.requestId,keys[0]);
    await f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner);
    for(const route of [`/api/comments/submissions?${new URLSearchParams({resource})}`,`/api/comments/submissions/receipt?${new URLSearchParams({requestId:keys[0]})}`])
      assert.equal((await fetch(`${restarted.url}${route}`,{headers})).status,401);
  });
  test(`${dialect}: discussion pages cross the legacy ceiling with exact scoped cursors, bounded queries and minimized ownership`,async t=>{
    const f=await fixture(t,dialect),server=await startServer(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,...(f.url?{DATABASE_URL:f.url}:{}),PORT:'0',LOG_REQUESTS:'false'}));t.after(()=>server.close());
    const api=async(route:string,body?:unknown,cookie='')=>fetch(`${server.url}${route}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const login=await api('/api/auth/demo',{}),owner=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const post=await f.add({id:' page-parent/?%# ',owner}),resource=`post/${post.id}`;
    const insert=f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)');
    await f.db.transaction(async()=>{
      for(let i=0;i<551;i++)await insert.run(i===49?'page-0049/'+ '界'.repeat(189)+' ':`page-${String(i).padStart(4,'0')}`,resource,i%2?f.owners[1]:owner,'Synthetic page author',`Original page comment ${i}.`,'2026-01-01T00:00:00.000Z',i?'page-0000':null);
      await insert.run('unrelated-page','lesson/other',owner,'Synthetic page author','A different discussion.','2026-01-01T00:00:00.000Z',null);
    });
    const path=(extra:Record<string,string>={})=>`/api/comments/page?${new URLSearchParams({resource,...extra})}`;
    const first=await api(path(),undefined,cookie);assert.equal(first.status,200);
    const page=await first.json();assert.deepEqual(Object.keys(page).sort(),['comments','limit','nextCursor'].sort());
    assert.equal(page.limit,50);assert.equal(page.comments.length,50);assert.equal(page.comments[0].id,'page-0000');
    for(const [i,row] of page.comments.entries()){
      assert.deepEqual(Object.keys(row).sort(),['author','body','createdAt','id','isMine','parentId','resource'].sort());
      assert.equal(row.resource,resource);assert.equal(row.isMine,i%2===0);
      assert.ok(!JSON.stringify(row).includes(owner));assert.ok(!JSON.stringify(row).includes(f.owners[1]));
    }
    assert.ok(page.nextCursor);assert.ok(!Buffer.from(page.nextCursor,'base64url').toString('utf8').includes(owner));
    assert.equal((await api(path({cursor:page.nextCursor}))).status,400);
    const mismatches:Record<string,string>[]=[{resource:'lesson/other'},{limit:'25'}];
    for(const extra of mismatches)assert.equal((await api(path({...extra,cursor:page.nextCursor}),undefined,cookie)).status,400);
    for(const suffix of ['&limit=51','&limit=500','&limit=0','&resource=duplicate','&cursor=','&cursor=%','&cursor=eyJ9','&cursor='+ 'a'.repeat(4097),'&viewer=forged'])
      assert.equal((await api(path()+suffix,undefined,cookie)).status,400,suffix.slice(0,80));
    const boundary=JSON.parse(Buffer.from(page.nextCursor,'base64url').toString('utf8'));
    for(const changed of [{...boundary,version:'community-feed-v1'},{...boundary,hash:'0'.repeat(64)},{...boundary,account:owner},{...boundary,id:'x'.repeat(201)}])
      assert.equal((await api(path({cursor:Buffer.from(JSON.stringify(changed)).toString('base64url')}),undefined,cookie)).status,400);
    const invalidUtf8=Buffer.concat([Buffer.from(JSON.stringify({...boundary,id:'UTF8_BOUNDARY'}).split('UTF8_BOUNDARY')[0]),Buffer.from([0xff]),Buffer.from(JSON.stringify({...boundary,id:'UTF8_BOUNDARY'}).split('UTF8_BOUNDARY')[1])]).toString('base64url');
    assert.equal((await api(path({cursor:invalidUtf8}),undefined,cookie)).status,400);
    for(const resource of ['post/',' post/ambiguous','lesson/'+ 'x'.repeat(150),'post/'+ 'x'.repeat(201),'lesson/\0bad'])
      assert.equal((await api(`/api/comments/page?${new URLSearchParams({resource})}`)).status,400,resource);
    const anonymous=await(await api(path({limit:'25'}))).json();assert.equal(anonymous.comments.length,25);assert.ok(anonymous.comments.every((row:{isMine:boolean})=>!row.isMine));
    const ids:string[]=page.comments.map((row:{id:string})=>row.id);let cursor=page.nextCursor,pages=1;
    while(cursor){assert.ok(pages++<20);const response=await api(path({cursor}),undefined,cookie);assert.equal(response.status,200);const next=await response.json();assert.ok(next.comments.length<=50);ids.push(...next.comments.map((row:{id:string})=>row.id));cursor=next.nextCursor;}
    assert.equal(ids.length,551);assert.equal(new Set(ids).size,551);assert.equal(ids.at(-1),'page-0550');
    const legacy=await api(`/api/comments?${new URLSearchParams({resource})}`,undefined,cookie);assert.equal((await legacy.json()).length,500);
    const empty=await(await api('/api/comments/page?resource=lesson%2Fempty')).json();assert.deepEqual(empty,{comments:[],limit:50,nextCursor:null});
    const created=await api('/api/comments',{resource,body:'A newly created comment is visible without replaying 551 earlier comments.'},cookie);assert.equal(created.status,201);
    const saved=await created.json();assert.equal(saved.id,saved.comment.id);assert.equal(saved.comment.resource,resource);assert.equal(saved.comment.isMine,true);assert.ok(!JSON.stringify(saved).includes(owner));assert.ok(!Object.hasOwn(saved.comment,'revision'));
    const exactParent=' '+ '界'.repeat(198)+' ';
    await insert.run(exactParent,resource,f.owners[1],'Synthetic page author','An exact 200-unit opaque parent.','2026-01-01T00:00:00.000Z',null);
    const reply=await api('/api/comments',{resource,parentId:exactParent,body:'A reply keeps the exact bounded parent without trimming.'},cookie);
    assert.equal(reply.status,201);assert.equal((await reply.json()).comment.parentId,exactParent);
    for(const parentId of [false,0,[],{},'x'.repeat(201),'bad\0parent',exactParent.trim()])
      assert.equal((await api('/api/comments',{resource,parentId,body:'Invalid or normalized parent must not be used.'},cookie)).status,400);
    const liveResource='lesson/live-pages';
    await f.db.transaction(async()=>{for(let i=0;i<51;i++)await insert.run(`live-${String(i).padStart(4,'0')}`,liveResource,owner,'Synthetic page author',`Live original ${i}.`,'2026-01-01T00:00:00.000Z',null);});
    const livePath=(cursor?:string)=>`/api/comments/page?${new URLSearchParams({resource:liveResource,limit:'25',...(cursor?{cursor}:{})})}`;
    const liveFirst=await(await api(livePath(),undefined,cookie)).json();assert.equal(liveFirst.comments.length,25);
    await f.db.prepare('DELETE FROM comments WHERE id IN (?,?)').run('live-0024','live-0025');
    await f.db.prepare('UPDATE comments SET body=? WHERE id=?').run('Updated between public pages.','live-0026');
    await insert.run('live-before',liveResource,owner,'Synthetic page author','Backdated insertion before the cursor.','2025-01-01T00:00:00.000Z',null);
    await insert.run('live-after',liveResource,owner,'Synthetic page author','New insertion after the cursor.','2027-01-01T00:00:00.000Z',null);
    const liveNext=await(await api(livePath(liveFirst.nextCursor),undefined,cookie)).json();
    assert.equal(liveNext.comments.length,25);assert.equal(liveNext.comments[0].id,'live-0026');assert.equal(liveNext.comments[0].body,'Updated between public pages.');
    const liveLast=await(await api(livePath(liveNext.nextCursor),undefined,cookie)).json();assert.deepEqual(liveLast.comments.map((row:{id:string})=>row.id),['live-after']);assert.equal(liveLast.nextCursor,null);
    for(const route of ['/api/comments','/api/comments/page'])assert.equal((await api(`${route}?${new URLSearchParams({resource:'lesson/\0bad'})}`)).status,400);
    assert.equal((await api('/api/comments',{resource:'lesson/\0bad',body:'NUL resources must not reach either database adapter.'},cookie)).status,400);
    const indexes=await f.db.prepare(dialect==='sqlite'?"SELECT name FROM sqlite_schema WHERE type='index' AND name='comments_resource_cursor'":"SELECT indexname AS name FROM pg_indexes WHERE schemaname=current_schema() AND indexname='comments_resource_cursor'").all();
    assert.equal(indexes.length,1);
  });
  test(`${dialect}: missing comment revisions abort writes and reopening never resets an existing version`,async t=>{
    const f=await fixture(t,dialect),id=randomUUID();
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,'lesson/version-integrity',f.owners[0],'Synthetic author','Original version-integrity comment.','2026-01-01T00:00:00.000Z',null);
    await f.db.prepare('UPDATE comments SET body=body WHERE id=?').run(id);
    assert.equal((await f.db.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(id))?.revision,1);
    if(dialect==='sqlite'){
      const reopened=localConnection(f.directory);
      try{assert.equal((await reopened.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(id))?.revision,1);}
      finally{await reopened.close();}
    }
    await f.db.prepare('DELETE FROM community_comment_revisions WHERE comment_id=?').run(id);
    await assert.rejects(f.db.prepare('UPDATE comments SET body=? WHERE id=?').run('This corrupt update must not commit.',id),/Missing community comment revision/);
    assert.equal((await f.db.prepare('SELECT body FROM comments WHERE id=?').get(id))?.body,'Original version-integrity comment.');
    if(dialect==='sqlite')assert.throws(()=>localConnection(f.directory),/comment revision data is incomplete/);
  });
  test(`${dialect}: owned comments expose only viewer ownership and use immutable-context revision-fenced text edits`,async t=>{
    const f=await fixture(t,dialect),server=await startServer(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,...(f.url?{DATABASE_URL:f.url}:{}),PORT:'0',LOG_REQUESTS:'false'}));t.after(()=>server.close());
    const api=async(route:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST')=>fetch(`${server.url}${route}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const login=await api('/api/auth/demo',{}),owner=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const other=await api('/api/auth/signup',{name:'Other local commenter',email:`${randomUUID()}@example.invalid`,password:'fixture-password-123'}),otherOwner=(await other.json()).user.id,otherCookie=other.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const post=await f.add({id:' comment-parent/..?%# ',owner:otherOwner}),resource=`post/${post.id}`,id=' exact/comment?%# ';
    const parent=randomUUID();
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(parent,resource,otherOwner,'Other local commenter','An original parent comment.','2026-01-01T00:00:00.000Z',null);
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,resource,owner,'Synthetic commenter','The original owned reply.','2026-01-01T00:00:00.000Z',parent);
    const route=`/api/comments/owned?${new URLSearchParams({id})}`;
    const initial=await api(route,undefined,cookie);assert.equal(initial.status,200);
    const snapshot=await initial.json();assert.equal(snapshot.revision,0);assert.equal(snapshot.comment.isMine,true);
    for(const [viewer,mine] of [[cookie,true],[otherCookie,false],['',false]] as const){
      const response=await api(`/api/comments?${new URLSearchParams({resource})}`,undefined,viewer);assert.equal(response.status,200);
      const row=(await response.json()).find((comment:{id:string})=>comment.id===id);
      assert.equal(row.isMine,mine);assert.deepEqual(Object.keys(row).sort(),['author','body','createdAt','id','isMine','parentId','resource'].sort());
      assert.ok(!JSON.stringify(row).includes(owner));assert.ok(!Object.hasOwn(row,'revision'));
    }
    assert.equal((await api(route)).status,401);assert.equal((await api(route,undefined,otherCookie)).status,404);
    for(const suffix of ['&id=duplicate','&owner=forged'])assert.equal((await api(route+suffix,undefined,cookie)).status,400);
    const draft={id,revision:0,body:'An updated original owned reply.'};
    assert.equal((await api('/api/comments/owned',draft,otherCookie,'PUT')).status,404);
    const saved=await api('/api/comments/owned',draft,cookie,'PUT');assert.equal(saved.status,200);
    const next=await saved.json();assert.equal(next.revision,1);
    assert.deepEqual({...next.comment,body:snapshot.comment.body},snapshot.comment);
    assert.equal((await api('/api/comments/owned',draft,cookie,'PUT')).status,409);
    for(const extra of [{author:owner},{resource:'lesson/forged'},{parentId:null},{createdAt:'2027-01-01T00:00:00.000Z'}])
      assert.equal((await api('/api/comments/owned',{...draft,revision:1,...extra},cookie,'PUT')).status,400);
    for(const body of ['x','\0invalid','x'.repeat(3001)])
      assert.equal((await api('/api/comments/owned',{...draft,revision:1,body},cookie,'PUT')).status,400);
    const competing=await Promise.all(['First competing reply','Second competing reply'].map(body=>api('/api/comments/owned',{...draft,revision:1,body},cookie,'PUT')));
    assert.deepEqual(competing.map(response=>response.status).sort(),[200,409]);
    await f.db.prepare('UPDATE comments SET body=? WHERE id=?').run(snapshot.comment.body,id);
    assert.equal((await api('/api/comments/owned',draft,cookie,'PUT')).status,409);
    assert.equal((await api('/api/posts/owned',{id:post.id,revision:0},otherCookie,'DELETE')).status,200);
    assert.equal((await api('/api/comments/owned',{...draft,revision:3},cookie,'PUT')).status,404);
    assert.equal(await f.db.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(id),undefined);
    const generic=randomUUID();
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(generic,'lesson/original-fixture',owner,'Synthetic commenter','A generic local discussion comment.','2026-01-01T00:00:00.000Z',null);
    assert.equal((await api('/api/comments/owned',{...draft,id:generic,body:'OK'},cookie,'PUT')).status,200);
    const maximum=await api('/api/comments/owned',{...draft,id:generic,revision:1,body:'x'.repeat(3000)},cookie,'PUT');assert.equal(maximum.status,200);
    assert.equal((await maximum.json()).comment.body.length,3000);
    await f.db.prepare('UPDATE community_comment_revisions SET revision=? WHERE comment_id=?').run(2147483647,generic);
    assert.equal((await api('/api/comments/owned',{...draft,id:generic,revision:2147483647},cookie,'PUT')).status,409);
  });
  test(`${dialect}: missing revision data fails explicitly without changing posts or resetting prior revisions`,async t=>{
    const f=await fixture(t,dialect),post=await f.add();
    await f.db.prepare('UPDATE posts SET title=title WHERE id=?').run(post.id);
    assert.equal((await f.db.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,1);
    if(dialect==='sqlite'){
      const reopened=localConnection(f.directory);
      try{assert.equal((await reopened.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(post.id))?.revision,1);}
      finally{await reopened.close();}
    }
    await f.db.prepare('DELETE FROM community_post_revisions WHERE post_id=?').run(post.id);
    await assert.rejects(f.db.prepare('UPDATE posts SET title=? WHERE id=?').run('This corrupt edit must not commit',post.id),/Missing community post revision/);
    assert.equal((await f.db.prepare('SELECT title FROM posts WHERE id=?').get(post.id))?.title,post.title);
    if(dialect==='sqlite')assert.throws(()=>localConnection(f.directory),/revision data is incomplete/);
  });
  test(`${dialect}: owned original contributions use revision-fenced edits and exact discussion deletion without exposing author IDs`,async t=>{
    const f=await fixture(t,dialect),server=await startServer(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,...(f.url?{DATABASE_URL:f.url}:{}),PORT:'0',LOG_REQUESTS:'false'}));t.after(()=>server.close());
    const api=async(route:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST')=>fetch(`${server.url}${route}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const login=await api('/api/auth/demo',{}),owner=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const other=await api('/api/auth/signup',{name:'Other local actor',email:`${randomUUID()}@example.invalid`,password:'fixture-password-123'}),otherCookie=other.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const saved=await f.add({id:' ./?#%\\ ',owner}),route=`/api/posts/owned?${new URLSearchParams({id:saved.id})}`;
    const initial=await api(route,undefined,cookie);assert.equal(initial.status,200);
    const snapshot=await initial.json();assert.equal(snapshot.revision,0);privateDto(snapshot.post,owner);assert.equal(snapshot.post.isMine,true);
    assert.equal((await api(route)).status,401);assert.equal((await api(route,undefined,otherCookie)).status,404);
    for(const suffix of ['&id=duplicate','&authorId=forged'])
      assert.equal((await api(route+suffix,undefined,cookie)).status,400);
    const draft={id:saved.id,revision:0,title:'Edited original contribution',body:'An updated original contribution explaining the complete reasoning.'};
    assert.equal((await api('/api/posts/owned',draft,otherCookie,'PUT')).status,404);
    const edited=await api('/api/posts/owned',draft,cookie,'PUT');assert.equal(edited.status,200);
    const next=await edited.json();assert.equal(next.revision,1);assert.equal(next.post.title,draft.title);assert.equal(next.post.kind,saved.kind);assert.equal(next.post.track,saved.track);assert.equal(next.post.author,'Anonymous');
    assert.deepEqual({...next.post,title:snapshot.post.title,body:snapshot.post.body},snapshot.post);
    assert.equal((await api('/api/posts/owned',{...draft,title:'A stale draft must not win'},cookie,'PUT')).status,409);
    assert.equal((await api('/api/posts/owned',{id:saved.id,revision:0},cookie,'DELETE')).status,409);
    for(const extra of [{authorId:owner},{sample:false},{track:'code'},{kind:'stories'}])
      assert.equal((await api('/api/posts/owned',{...draft,revision:1,...extra},cookie,'PUT')).status,400);
    for(const revision of [-1,0.5,2147483648])
      assert.equal((await api('/api/posts/owned',{...draft,revision},cookie,'PUT')).status,400);
    for(const invalid of [{title:'bad\0title'},{body:'A body containing invalid\0stored text.'}])
      assert.equal((await api('/api/posts/owned',{...draft,revision:1,...invalid},cookie,'PUT')).status,400);
    const sample=await f.add({sample:true,owner}),sampleRoute=`/api/posts/owned?${new URLSearchParams({id:sample.id})}`;
    assert.equal((await api(sampleRoute,undefined,cookie)).status,404);
    assert.equal((await api('/api/posts/owned',{...draft,id:sample.id},cookie,'PUT')).status,404);
    assert.equal((await api('/api/posts/owned',{id:sample.id,revision:0},cookie,'DELETE')).status,404);
    const root=randomUUID(),outside=randomUUID(),resource=`post/${saved.id}`,otherResource='lesson/retained-original-fixture';
    await f.db.prepare('INSERT INTO votes VALUES(?,?)').run(saved.id,owner);await f.db.prepare('INSERT INTO follows VALUES(?,?)').run(saved.id,f.owners[1]);
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(root,resource,owner,'Synthetic author','Exact thread comment','2026-01-01T00:00:00.000Z',null);
    await f.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(outside,otherResource,f.owners[1],'Synthetic author','Legacy cross-resource child must remain','2026-01-01T00:00:00.000Z',root);
    assert.equal((await api('/api/posts/owned',{id:saved.id,revision:1},otherCookie,'DELETE')).status,404);
    const deleted=await api('/api/posts/owned',{id:saved.id,revision:1},cookie,'DELETE');assert.equal(deleted.status,200);assert.deepEqual(await deleted.json(),{deleted:true});
    for(const table of ['posts','community_post_revisions'])assert.equal(await f.db.prepare(`SELECT * FROM ${table} WHERE ${table==='posts'?'id':'post_id'}=?`).get(saved.id),undefined);
    for(const table of ['votes','follows'])assert.deepEqual(await f.db.prepare(`SELECT * FROM ${table} WHERE post_id=?`).all(saved.id),[]);
    assert.deepEqual(await f.db.prepare('SELECT * FROM comments WHERE resource=?').all(resource),[]);
    const retained=await f.db.prepare('SELECT body,parent_id FROM comments WHERE id=?').get(outside);assert.equal(retained?.body,'Legacy cross-resource child must remain');assert.equal(retained?.parent_id,null);
    assert.equal((await f.db.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(outside))?.revision,1);
    assert.equal((await api('/api/comments',{resource,body:'A stale comment cannot recreate the deleted discussion.'},cookie)).status,404);
    assert.equal((await api('/api/posts/owned',{id:saved.id,revision:1},cookie,'DELETE')).status,404);
    const concurrent=await f.add({owner});
    const results=await Promise.all(['First competing original edit','Second competing original edit'].map(title=>api('/api/posts/owned',{...draft,id:concurrent.id,title},cookie,'PUT')));
    assert.deepEqual(results.map(response=>response.status).sort(),[200,409]);
    assert.equal((await f.db.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(concurrent.id))?.revision,1);
    const aba=await f.add({owner});
    await f.db.prepare('UPDATE posts SET title=? WHERE id=?').run('An intervening original title',aba.id);
    await f.db.prepare('UPDATE posts SET title=? WHERE id=?').run(aba.title,aba.id);
    assert.equal((await api('/api/posts/owned',{...draft,id:aba.id},cookie,'PUT')).status,409);
    assert.equal((await api('/api/posts/owned',{id:aba.id,revision:0},cookie,'DELETE')).status,409);
    const exhausted=await f.add({owner});
    await f.db.prepare('UPDATE community_post_revisions SET revision=? WHERE post_id=?').run(2147483647,exhausted.id);
    assert.equal((await api('/api/posts/owned',{...draft,id:exhausted.id,revision:2147483647},cookie,'PUT')).status,409);
    assert.equal((await f.db.prepare('SELECT title FROM posts WHERE id=?').get(exhausted.id))?.title,exhausted.title);
    assert.equal((await api('/api/posts/owned',{id:exhausted.id,revision:2147483647},cookie,'DELETE')).status,200);
  });
  test(`${dialect}: all public post DTOs omit account IDs and derive owned flags without revealing stored question names`,async t=>{
    const f=await fixture(t,dialect),[owner,other]=f.owners;
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
    const f=await fixture(t,dialect),[owner,other]=f.owners;
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
    const f=await fixture(t,dialect);
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
    const f=await fixture(t,dialect),old=await f.add({id:'old-question',body:'🙂'.repeat(300),createdAt:'2020-01-01T00:00:00.000Z'});
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
  test(`${dialect}: actual HTTP readers enforce closed query fields and retain private-safe compatibility and direct detail`,async t=>{
    const f=await fixture(t,dialect),question=await f.add({body:`${'z'.repeat(350)} unique-body-only-match`});
    const server=await startServer(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,...(f.url?{DATABASE_URL:f.url}:{}),PORT:'0',LOG_REQUESTS:'false'}));
    t.after(()=>server.close());
    const api=async(route:string)=>{const response=await fetch(`${server.url}${route}`);return{response,body:await response.json()};};
    const legacy=await api('/api/posts?kind=questions');assert.equal(legacy.response.status,200);assert.equal(legacy.response.headers.get('x-community-truncated'),'false');privateDto(legacy.body[0],f.owners[0]);
    const feed=await api('/api/community/posts?q=unique-body-only-match');assert.equal(feed.response.status,200);
    assert.equal(feed.body.posts[0].id,question.id);privateDto(feed.body.posts[0],f.owners[0]);
    assert.match(feed.response.headers.get('cache-control') ?? '',/no-store/);
    const detail=await api(`/api/community/posts/${question.id}?kind=questions`);assert.equal(detail.body.body,question.body);privateDto(detail.body,f.owners[0]);
    for(const query of ['kind=questions&kind=stories','q=one&q=two','limit=10000','owner=untrusted','q=bad%00text'])
      assert.equal((await api(`/api/community/posts?${query}`)).response.status,400);
    assert.equal((await api(`/api/community/posts/${question.id}?kind=questions&owner=untrusted`)).response.status,400);
    assert.equal((await api(`/api/community/posts/${question.id}?kind=submissions`)).response.status,404);
  });
  test(`${dialect}: query-addressed HTTP details preserve opaque identifiers and exact kind and track`,async t=>{
    const f=await fixture(t,dialect);
    const server=await startServer(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,...(f.url?{DATABASE_URL:f.url}:{}),PORT:'0',LOG_REQUESTS:'false'}));
    t.after(()=>server.close());
    const ids=['.','..','a/b?c#d%\\e',' padded ','padded',' padded','%','literal%2F','界'.repeat(200)];
    for(const [index,id] of ids.entries()){
      const track=index%2?'':'legacy/track?x#y\\..';
      const saved=await f.add({id,kind:'submissions',track});
      const query=new URLSearchParams({id,kind:'submissions',track});
      const response=await fetch(`${server.url}/api/community/post?${query}`);
      assert.equal(response.status,200,JSON.stringify(id));
      const detail=await response.json();assert.equal(detail.id,id);assert.equal(detail.track,track);assert.equal(detail.body,saved.body);privateDto(detail,f.owners[0]);
      query.set('kind','questions');
      assert.equal((await fetch(`${server.url}/api/community/post?${query}`)).status,404);
      query.set('kind','submissions');query.set('track','not-the-saved-track');
      assert.equal((await fetch(`${server.url}/api/community/post?${query}`)).status,404);
    }
    for(const query of ['id=.&kind=questions&kind=stories','id=.&id=..&kind=questions','id=&kind=questions','id=.&kind=unknown','id=.&kind=questions&owner=untrusted','id=bad%00text&kind=questions',`id=${'x'.repeat(201)}&kind=questions`])
      assert.equal((await fetch(`${server.url}/api/community/post?${query}`)).status,400,query);
    await f.add({id:'detail'});
    const compatibility=await fetch(`${server.url}/api/community/posts/detail?kind=questions`);
    assert.equal(compatibility.status,200);assert.equal((await compatibility.json()).id,'detail');
    for(const route of ['/api/community/posts/%E0%A4?kind=questions','/api/community/post?kind=questions&id=%','/api/comments?resource=%C0%AE']){
      const response=await fetch(`${server.url}${route}`,{headers:{Accept:'text/html'}});
      assert.equal(response.status,400);assert.match(response.headers.get('content-type') ?? '',/json/);assert.deepEqual(await response.json(),{error:'Invalid address encoding.'});
    }
  });
  test(`${dialect}: exact-ID desired-state memberships and post discussions preserve actor and resource isolation`,async t=>{
    const f=await fixture(t,dialect);
    const server=await startServer(loadConfig({NODE_ENV:'production',DATA_DIR:f.directory,...(f.url?{DATABASE_URL:f.url}:{}),PORT:'0',LOG_REQUESTS:'false'}));t.after(()=>server.close());
    const request=async(route:string,body?:unknown,cookie='')=>fetch(`${server.url}${route}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    const login=await request('/api/auth/demo',{});assert.equal(login.status,200);
    const actor=(await login.json()).user.id,cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    assert.equal((await request('/api/posts/actions',{id:'.',action:'vote',enabled:true})).status,401);
    for(const [index,id] of ['.','..','a/b?c#d%\\e',' padded ','padded',' padded','界'.repeat(200)].entries()){
      await f.add({id});
      for(const action of ['vote','follow'] as const){
        const table=action==='vote'?'votes':'follows';
        const responses=await Promise.all(Array.from({length:3},()=>request('/api/posts/actions',{id,action,enabled:true},cookie)));
        assert.deepEqual(responses.map(response=>response.status),[200,200,200]);
        assert.deepEqual((await f.db.prepare(`SELECT user_id FROM ${table} WHERE post_id=?`).all(id)).map(row=>row.user_id),[actor]);
        for(let repeat=0;repeat<2;repeat++)assert.equal((await request('/api/posts/actions',{id,action,enabled:false},cookie)).status,200);
        assert.deepEqual(await f.db.prepare(`SELECT user_id FROM ${table} WHERE post_id=?`).all(id),[]);
      }
      const resource=`post/${id}`,comment=await request('/api/comments',{resource,body:`Exact comment ${index}.`},cookie);assert.equal(comment.status,201);
      const read=await request(`/api/comments?${new URLSearchParams({resource})}`);
      const rows=await read.json();assert.equal(rows.length,1);assert.equal(rows[0].resource,resource);assert.equal(rows[0].body,`Exact comment ${index}.`);
    }
    const spaced=await request(`/api/comments?${new URLSearchParams({resource:'post/ padded '})}`);
    const parent=(await spaced.json())[0].id;
    assert.equal((await request('/api/comments',{resource:'post/padded',parentId:parent,body:'Not the same resource.'},cookie)).status,400);
    for(const body of [{id:'.',action:'vote',enabled:true,userId:f.owners[0]},{id:'.',action:'vote',enabled:'true'},{id:'.',action:'unknown',enabled:true},{id:'.',action:'follow'},{id:'',action:'vote',enabled:true},{id:'x'.repeat(201),action:'vote',enabled:true},{id:'bad\0id',action:'vote',enabled:true}])
      assert.equal((await request('/api/posts/actions',body,cookie)).status,400);
    assert.equal((await request('/api/posts/actions',{id:'missing',action:'vote',enabled:true},cookie)).status,404);
    for(const resource of ['post/','post/bad\0id',`post/${'x'.repeat(201)}`,' post/padded','x'.repeat(151)])
      assert.equal((await request(`/api/comments?${new URLSearchParams({resource})}`)).status,400);
    await f.add({id:'legacy-action'});
    assert.equal((await request('/api/posts/legacy-action/vote',{},cookie)).status,200);
    assert.equal((await request('/api/posts/legacy-action/vote',{},cookie)).status,200);
    assert.deepEqual(await f.db.prepare('SELECT user_id FROM votes WHERE post_id=?').all('legacy-action'),[]);
  });
}
