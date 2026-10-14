import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { GET as bootstrap } from '../app/api/bootstrap/route';
import { GET as health } from '../app/api/health/route';
import { GET as ready } from '../app/api/ready/route';
import { GET as lesson } from '../app/api/content/lessons/[track]/[id]/route';
import { GET as problem } from '../app/api/content/problems/[id]/route';
import { GET as media } from '../app/api/content/media/[course]/[file]/route';
import { GET as community } from '../app/api/community/posts/route';
import { GET as communityPost } from '../app/api/community/posts/[id]/route';
import { GET as comments } from '../app/api/comments/page/route';
import { GET as posts } from '../app/api/posts/route';
import { postgresConnection } from '../server/db/connection';
import { migrateDatabase } from '../server/db/migrations';
import { prismaConnection } from '../server/db/prisma';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('Next.js health, readiness, Prisma transactions and visitor bootstrap use the migrated schema', {
  skip: !databaseUrl && 'TEST_DATABASE_URL is required for the PostgreSQL Next.js runtime fixture.',
}, async t => {
  const root = postgresConnection(databaseUrl!);
  const schema = `next_test_${randomUUID().replaceAll('-', '')}`;
  await root.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const migration = postgresConnection(url.href);
  await migrateDatabase(migration);
  await migration.close();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.href;
  for (const key of ['NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET',
    'AUTH_FACEBOOK_CLIENT_ID', 'AUTH_FACEBOOK_CLIENT_SECRET', 'AUTH_INVITED_EMAILS']) delete process.env[key];
  t.after(async () => {
    await prismaConnection().close();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    try { await root.exec(`DROP SCHEMA ${schema} CASCADE`); } finally { await root.close(); }
  });
  const db = prismaConnection();
  await assert.rejects(db.transaction(async () => {
    await db.prepare("INSERT INTO users (id,name,email,password,demo) VALUES (?,'Rollback owner',NULL,NULL,0)").run(randomUUID());
    await db.transaction(async () => { throw new Error('rollback'); });
  }), /rollback/);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM users').get())?.count, 0);
  const healthPayload = await health().json();
  const readyResponse = await ready(), readyPayload = await readyResponse.json();
  const bootstrapResponse = await bootstrap(), bootstrapPayload = await bootstrapResponse.json();
  assert.deepEqual(healthPayload, { status: 'ok' });
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(readyPayload, { status: 'ready', mode: 'service' });
  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapPayload.user, null);
  assert.equal(bootstrapPayload.capabilities.auth.system, 'authjs');
  assert.equal(bootstrapPayload.capabilities.access.state, 'visitor');
  const owner = 'next-public-owner';
  const postId = 'a/b?c#d%\\e';
  await db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,?,0)')
    .run(owner, 'Private fixture owner', 'next-public-owner@example.test', null);
  await db.prepare(`INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).run(postId, 'questions', 'Opaque Next community question',
      'A public-safe body loaded through the Next.js read surface.', 'Fixture Company', 'system-design', 'Senior',
      'Global', 'THIS PRIVATE AUTHOR MUST NOT LEAK', owner, '2026-11-01T00:00:00.000Z');
  await db.prepare(`INSERT INTO comments(id,resource,user_id,author,body,created_at,parent_id)
    VALUES(?,?,?,?,?,?,NULL)`).run('next-public-comment', `post/${postId}`, owner, 'Public commenter',
      'A public-safe nested discussion comment.', '2026-11-01T00:00:01.000Z');
  const lessonResponse = await lesson(new Request('http://studio.fixture/api/content/lessons/system-design/introduction'), {
    params: Promise.resolve({ track: 'system-design', id: 'introduction' }),
  });
  const problemResponse = await problem(new Request('http://studio.fixture/api/content/problems/short-links'), {
    params: Promise.resolve({ id: 'short-links' }),
  });
  const mediaResponse = await media(new Request('http://studio.fixture/api/content/media/system-design/system-design.vtt'), {
    params: Promise.resolve({ course: 'system-design', file: 'system-design.vtt' }),
  });
  const communityResponse = await community(new Request('http://studio.fixture/api/community/posts?limit=6'));
  const communityPostResponse = await communityPost(new Request('http://studio.fixture/api/community/posts/opaque?kind=questions'), {
    params: Promise.resolve({ id: postId }),
  });
  const commentsResponse = await comments(new Request(
    `http://studio.fixture/api/comments/page?resource=${encodeURIComponent(`post/${postId}`)}`,
  ));
  const postsResponse = await posts(new Request('http://studio.fixture/api/posts?kind=questions'));
  const duplicateQueryResponse = await community(new Request('http://studio.fixture/api/community/posts?limit=6&limit=7'));
  assert.equal(lessonResponse.status, 200);
  assert.equal((await lessonResponse.json()).id, 'introduction');
  assert.match(lessonResponse.headers.get('X-Content-Version') ?? '', /^[a-f0-9]{64}$/);
  assert.equal(problemResponse.status, 200);
  assert.equal((await problemResponse.json()).id, 'short-links');
  assert.equal(mediaResponse.status, 200);
  assert.equal(mediaResponse.headers.get('Content-Type'), 'text/vtt; charset=utf-8');
  assert.ok((await mediaResponse.arrayBuffer()).byteLength > 100);
  const communityPayload = await communityResponse.json();
  assert.equal(communityPayload.total, 1);
  assert.equal(communityPayload.posts[0].id, postId);
  assert.equal(communityPayload.posts[0].author, 'Anonymous');
  assert.ok(!JSON.stringify(communityPayload).includes(owner));
  const communityPostPayload = await communityPostResponse.json();
  assert.equal(communityPostResponse.status, 200);
  assert.equal(communityPostPayload.id, postId);
  assert.equal(communityPostPayload.author, 'Anonymous');
  assert.ok(!JSON.stringify(communityPostPayload).includes(owner));
  const commentsPayload = await commentsResponse.json();
  assert.equal(commentsResponse.status, 200);
  assert.equal(commentsPayload.comments[0].body, 'A public-safe nested discussion comment.');
  assert.equal(commentsPayload.comments[0].author, 'Public commenter');
  assert.ok(!JSON.stringify(commentsPayload).includes(owner));
  const postsPayload = await postsResponse.json();
  assert.equal(postsPayload.length, 1);
  assert.equal(postsPayload[0].id, postId);
  assert.equal(postsPayload[0].author, 'Anonymous');
  assert.equal(duplicateQueryResponse.status, 400);
});
