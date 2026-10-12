import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { CommunityReads } from '../server/community';
import { localConnection, postgresConnection, type Database } from '../server/db/connection';
import { assertDatabaseVersion, migrateDatabase, migrations } from '../server/db/migrations';
import { HttpError } from '../server/http-error';
import { loadConfig } from '../server/config';
import { startServer } from '../server/runtime';
import type { CommunityPost } from '../shared/types';

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

test('migration 21 preserves actual migration-20 posts, memberships and immutable history while adding read indexes',async t=>{
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
  const before=await Promise.all(['posts','votes','follows'].map(table=>legacy.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()));
  const history=await legacy.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  await assert.rejects(assertDatabaseVersion(legacy),/incompatible/);
  await migrateDatabase(legacy);await migrateDatabase(legacy);await assertDatabaseVersion(legacy);
  assert.deepEqual(await Promise.all(['posts','votes','follows'].map(table=>legacy.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all())),before);
  assert.deepEqual(await legacy.prepare('SELECT version,name,checksum FROM schema_migrations WHERE version<=20 ORDER BY version').all(),history);
  const indexes=await legacy.prepare('SELECT indexname FROM pg_indexes WHERE schemaname=?').all(schema);
  for(const name of ['posts_owner_order','posts_created_order','follows_owner'])assert.ok(indexes.some(row=>row.indexname===name));
  assert.equal((await new CommunityReads(legacy).detail(post.id,{kind:'questions'},f.owners[0])).isMine,true);
});

for(const dialect of ['sqlite','postgres'] as const){
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
}
