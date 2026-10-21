import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emptyState } from '../shared/domain';
import { quizQuestions } from '../shared/catalog';
import type { UserState } from '../shared/types';
import { postgresConnection, postgresParameters, type Database } from '../server/db/connection';
import { applyLegacyImport, inspectLegacyImport } from '../server/db/legacy-import';
import { assertDatabaseVersion, migrateDatabase, migrations, recordTables } from '../server/db/migrations';
import { StateRepository } from '../server/db/state-repository';
import { ContentRepository } from '../server/content/repository';
import { publishedQuestion } from '../server/content/schema';
import { HttpError } from '../server/http-error';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to a dedicated PostgreSQL test database. Each test owns and removes a unique schema.');

async function fixture(t: TestContext, migrate = true) {
  const root = postgresConnection(databaseUrl!);
  const schema = `studio_test_${randomUUID().replaceAll('-', '')}`;
  await root.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = postgresConnection(url.href);
  t.after(async () => {
    try { await db.close(); } finally {
      try { await root.exec(`DROP SCHEMA ${schema} CASCADE`); } finally { await root.close(); }
    }
  });
  if (migrate) await migrateDatabase(db);
  return { db, url: url.href };
}
async function temporaryDirectory(t: TestContext) {
  const parent = path.resolve('data/database-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'database-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function account(db: Database, state = emptyState()) {
  const id = randomUUID();
  await db.transaction(async () => {
    await db.prepare('INSERT INTO users (id,name,email,password,demo) VALUES (?,?,?,NULL,0)').run(id, 'Fixture', `${id}@example.invalid`);
    await new StateRepository(db).initialize(id, state);
  });
  return id;
}
test('PostgreSQL parameter conversion preserves quoted literals and identifiers', () => {
  assert.equal(postgresParameters(`SELECT '?' AS "?", 'it''s ?' WHERE id=? AND name=?`), `SELECT '?' AS "?", 'it''s ?' WHERE id=$1 AND name=$2`);
});

test('controlled migrations are repeatable, serialize runners, and reject missing or changed history', async t => {
  const { db, url } = await fixture(t, false);
  await assert.rejects(assertDatabaseVersion(db), /migrations are missing/);
  const another = postgresConnection(url);
  t.after(() => another.close());
  await Promise.all([migrateDatabase(db), migrateDatabase(another)]);
  await assertDatabaseVersion(db);
  const rows = await db.prepare('SELECT version,checksum FROM schema_migrations').all();
  assert.equal(rows.length, migrations.length);
  await db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run('corrupted-fixture');
  await assert.rejects(assertDatabaseVersion(db), /incompatible/);
  await assert.rejects(migrateDatabase(db), /history does not match/);
});
test('production cleanup removes only marked demo accounts and sample activity, preserving real state and training bytes', async t => {
  const { db } = await fixture(t, false);
  await db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const migration of migrations.filter(item => item.version < 42)) {
    await db.exec(migration.sql);
    await db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)')
      .run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'));
  }
  const real = await account(db, { ...emptyState(), read: ['system-design/introduction'], recognition: 7 });
  const before = await new StateRepository(db).read(real);
  await db.prepare("INSERT INTO users(id,name,email,demo) VALUES('demo-owner','Demonstration','demo@example.invalid',1)").run();
  await new StateRepository(db).initialize('demo-owner', { ...emptyState(), recognition: 999 });
  for (const [id, owner, sample] of [['sample-post', real, 1], ['demo-post', 'demo-owner', 0], ['real-post', real, 0]] as const) {
    await db.prepare(`INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample)
      VALUES(?,'discussion','Preserved title','Preserved original body','','system-design','Senior','Global','Author',?,'2026-01-01T00:00:00.000Z',?)`).run(id, owner, sample);
  }
  await db.prepare(`INSERT INTO comments(id,resource,user_id,author,body,created_at)
    VALUES('demo-comment','lesson/system-design/introduction','demo-owner','Demonstration','Fake activity','2026-01-01')`).run();
  await db.prepare(`INSERT INTO comments(id,resource,user_id,author,body,created_at)
    VALUES('sample-reply','post/sample-post',?,'Real member','Reply to sample','2026-01-01')`).run(real);
  await db.prepare(`INSERT INTO comments(id,resource,user_id,author,body,created_at)
    VALUES('real-comment','post/real-post',?,'Real member','Real discussion','2026-01-01')`).run(real);
  await new ContentRepository(db).createSession(real, 'api-design', quizQuestions.filter(question => question.topic === 'api-design').slice(0, 2));
  const content = await db.prepare('SELECT id,value FROM content_versions ORDER BY id').all();
  assert.ok(content.length);
  const post = await db.prepare("SELECT * FROM posts WHERE id='real-post'").get();
  await migrateDatabase(db);
  await migrateDatabase(db);
  assert.equal(await db.prepare("SELECT id FROM users WHERE demo=1").get(), undefined);
  assert.deepEqual((await db.prepare('SELECT id FROM posts ORDER BY id').all()).map(row => row.id), ['real-post']);
  assert.deepEqual((await db.prepare('SELECT id FROM comments ORDER BY id').all()).map(row => row.id), ['real-comment']);
  assert.deepEqual(await new StateRepository(db).read(real), before);
  assert.deepEqual(await db.prepare('SELECT id,value FROM content_versions ORDER BY id').all(), content);
  assert.deepEqual(await db.prepare("SELECT * FROM posts WHERE id='real-post'").get(), post);
});
test('versioned assessment answers are single-owner and revision-fenced across PostgreSQL pools',async t=>{
  const {db,url}=await fixture(t),owner=await account(db),anotherOwner=await account(db);
  const replica=postgresConnection(url);
  t.after(()=>replica.close());
  const first=new ContentRepository(db),second=new ContentRepository(replica);
  const questions=quizQuestions.filter(question=>question.topic==='api-design').slice(0,2);
  const session=await db.transaction(()=>first.createSession(owner,'api-design',questions));
  await assert.rejects(second.sessionView(anotherOwner,session.id),error=>error instanceof HttpError&&error.status===404);
  const outcomes=await Promise.allSettled([
    first.answerSession(owner,session.id,questions[0].id,questions[0].correct,0),
    second.answerSession(owner,session.id,questions[0].id,questions[0].correct,0),
  ]);
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);
  const failure=outcomes.find(outcome=>outcome.status==='rejected');
  assert.ok(failure?.status==='rejected'&&failure.reason instanceof HttpError&&failure.reason.status===409);
  assert.equal((await second.sessionView(owner,session.id)).revision,1);
  await second.answerSession(owner,session.id,questions[1].id,-1,1);
  assert.equal((await first.sessionView(owner,session.id)).answered,2);
  await db.prepare('DELETE FROM users WHERE id=?').run(owner);
  assert.equal((await db.prepare('SELECT id FROM assessment_sessions WHERE user_id=?').all(owner)).length,0);
});
test('PostgreSQL owned rows preserve every collection, source bytes, owner isolation and unchanged rows', async t => {
  const { db } = await fixture(t);
  const state = emptyState();
  Object.assign(state, {
    read: ['system-design/introduction'], bookmarks: ['code/arrays'], review: ['fixture-question'],
    activity: ['2026-01-02'], enrollments: ['system-design'], watched: ['fixture-video'],
    targets: [{ id: 'target', company: 'Meta', level: 'Senior', role: 'Engineer', date: '' }],
    stories: [{ id: 'story', title: 'Fixture story', situation: 'Context', task: 'Goal', action: 'Action', result: 'Outcome', tags: ['fixture'] }],
    attempts: [{ id: 'attempt', problemId: 'short-links', level: 'Senior', answer: 'Fixture explanation', code: '  const value = "✓";\r\n\r\n', nodes: [], edges: [], completed: true, updatedAt: '2026-01-02', elapsed: 5, feedback: { score: 80, summary: 'Preserved', strengths: ['Good'], improvements: ['Next'], source: 'rubric' } }],
    quizzes: [{ id: 'quiz', topic: 'fixture-topic', answers: { 'fixture-question': 0 }, score: 1, total: 1, completedAt: '2026-01-02' }],
    certificates: [{ id: 'certificate', courseId: 'fixture-course', issuedAt: '2026-01-02' }],
    chat: [{ id: 'message', role: 'user', text: 'Fixture question', createdAt: '2026-01-02' }],
    mocks: [{ id: 'mock', problemId: 'short-links', company: 'Meta', level: 'Senior', length: 3, question: 'Question', focus: -1, draft: 'Draft', revision: 0, turns: [], createdAt: '2026-01-02' }],
    customQuizzes: [{ id: 'custom', title: 'Fixture', topics: ['fixture-topic'], mode: 'all', questionIds: ['fixture-question'], answers: {}, revision: 0, createdAt: '2026-01-02' }],
    studyPlans: [{ id: 'plan', company: 'Meta', level: 'Senior', weeks: 2, sessionsPerWeek: 3, tasks: [], createdAt: '2026-01-02' }],
    projects: [{ id: 'project', title: 'Fixture', problemId: 'event-dedup', files: [{ path: 'unicode.js', original: '  // 原文\r\n\r\n', content: '  // edited\r\n' }], explanation: '', verification: '', revision: 0, createdAt: '2026-01-02' }],
  } satisfies Partial<UserState>);
  const id = await account(db, state), other = await account(db);
  const states = new StateRepository(db);
  assert.deepEqual(await states.read(id), state);
  assert.deepEqual(await states.read(other), emptyState());
  for (const table of Object.values(recordTables)) {
    assert.equal((await db.prepare(`SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id=?`).get(id))!.count, 1);
  }
  const version = await db.prepare('SELECT xmin::text AS version FROM attempts WHERE user_id=?').get(id);
  await states.mutate(id, current => { current.bookmarks.push('fixture-second'); });
  assert.deepEqual(await db.prepare('SELECT xmin::text AS version FROM attempts WHERE user_id=?').get(id), version);
  await assert.rejects(db.prepare('INSERT INTO user_resources (user_id,kind,resource,position) VALUES (?,?,?,?)').run('absent-user', 'read', 'key', 0), { code: '23503' });
  await assert.rejects(states.mutate(id, current => { current.targets.push(current.targets[0]); }), /Duplicate resource identifiers/);
  assert.equal((await states.read(id)).targets.length, 1);
  await db.prepare('DELETE FROM users WHERE id=?').run(id);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM project_workspaces WHERE user_id=?').get(id))!.count, 0);
});

test('two PostgreSQL pools do not lose concurrent independent owner mutations', async t => {
  const { db, url } = await fixture(t);
  const id = await account(db), other = postgresConnection(url);
  t.after(() => other.close());
  const stores = [new StateRepository(db), new StateRepository(other)];
  await Promise.all(Array.from({ length: 40 }, (_, index) => stores[index % 2].mutate(id, state => {
    state.read.push(`lesson-${index}`);
    state.recognition++;
  })));
  const saved = await stores[0].read(id);
  assert.equal(saved.read.length, 40);
  assert.equal(new Set(saved.read).size, 40);
  assert.equal(saved.recognition, 40);
});

test('compiled migration/import commands perform explicit operations without development runtime tools', async t => {
  const { db, url } = await fixture(t, false);
  const execute = promisify(execFile);
  const migrated = await execute(process.execPath, ['dist-server/db/cli.js', 'migrate'], { env: { NODE_ENV: 'test', DATABASE_URL: url } });
  assert.match(migrated.stdout, /checksums verified/);
  await assertDatabaseVersion(db);
  const legacy = await legacyFixture(t);
  const inspected = await execute(process.execPath, ['dist-server/db/cli.js', 'import', '--source', legacy.source, '--user', 'legacy-owner'], { env: { NODE_ENV: 'test' } });
  const report = JSON.parse(inspected.stdout) as { mode: string; fingerprint: string; selectedUsers: number };
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.selectedUsers, 1);
  assert.ok(!inspected.stdout.includes('legacy@example.invalid'));
  const imported = await execute(process.execPath, ['dist-server/db/cli.js', 'import', '--source', legacy.source, '--user', 'legacy-owner', '--apply', report.fingerprint], { env: { NODE_ENV: 'test', DATABASE_URL: url } });
  assert.equal((JSON.parse(imported.stdout) as { mode: string }).mode, 'applied');
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM users').get())!.count, 1);
});

async function legacyFixture(t: TestContext) {
  const directory = await temporaryDirectory(t), source = path.join(directory, 'studio.sqlite');
  const db = new DatabaseSync(source);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT,demo INTEGER NOT NULL);
    CREATE TABLE states (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,value TEXT NOT NULL);
    CREATE TABLE sessions (token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE TABLE gifts (hash TEXT PRIMARY KEY,plan TEXT NOT NULL,creator TEXT NOT NULL,redeemed_by TEXT,created_at TEXT NOT NULL);
    CREATE TABLE posts (id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,company TEXT NOT NULL,
      track TEXT NOT NULL,level TEXT NOT NULL,region TEXT NOT NULL,author TEXT NOT NULL,author_id TEXT NOT NULL,created_at TEXT NOT NULL,sample INTEGER NOT NULL);
    CREATE TABLE votes (post_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(post_id,user_id));
    CREATE TABLE follows (post_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(post_id,user_id));
    CREATE TABLE comments (id TEXT PRIMARY KEY,resource TEXT NOT NULL,user_id TEXT,author TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,parent_id TEXT);
    CREATE TABLE support (id TEXT PRIMARY KEY,user_id TEXT,email TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE content_versions (id TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE assessment_sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,topic TEXT NOT NULL,content_version TEXT NOT NULL,
      answers TEXT NOT NULL,revision INTEGER NOT NULL,completed_at TEXT);
  `);
  const state = emptyState();
  state.plan = 'lifetime';
  state.attempts.push({ id: 'legacy-attempt', problemId: 'short-links', level: 'Senior', answer: 'Historical answer', code: '  // preserved\r\n', nodes: [], edges: [], completed: false, updatedAt: '2026-01-02', elapsed: 1 });
  state.projects.push({ id: 'legacy-project', title: 'Historical', problemId: 'event-dedup', files: [{ path: 'file.js', original: '// 原文\r\n', content: '// edit\r\n' }], explanation: '', verification: '', revision: 0, createdAt: '2026-01-02' });
  const raw = JSON.stringify(state, null, 2);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('legacy-owner', 'Legacy Fixture', 'legacy@example.invalid', 'not-imported-secret-hash', 0);
  db.prepare('INSERT INTO states VALUES (?,?)').run('legacy-owner', raw);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('legacy-demo', 'Demo Fixture', 'demo@local.invalid', null, 1);
  db.prepare('INSERT INTO states VALUES (?,?)').run('legacy-demo', JSON.stringify(emptyState()));
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('do-not-import-session', 'legacy-owner', Date.now() + 86400000);
  db.prepare('INSERT INTO gifts VALUES (?,?,?,?,?)').run('do-not-import-gift', 'year', 'legacy-owner', null, '2026-01-02');
  db.close();
  return { source, raw, state };
}

test('explicit import dry run preserves bytes, excludes demo authority, reconciles every record and rejects replay', async t => {
  const { db } = await fixture(t);
  const legacy = await legacyFixture(t);
  const bytes = await readFile(legacy.source);
  const input = inspectLegacyImport(legacy.source, ['legacy-owner']);
  assert.equal(input.report.excludedDemoUsers, 1);
  assert.equal(input.report.skippedSessions, 1);
  assert.equal(input.report.skippedGifts, 1);
  assert.equal(input.report.records.posts.excluded, 0);
  assert.deepEqual(await readFile(legacy.source), bytes);
  assert.deepEqual(inspectLegacyImport(legacy.source, ['legacy-owner']).report, input.report);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM users').get())!.count, 0);
  await assert.rejects(applyLegacyImport(db, input, 'unapproved'), /exact approved/);
  await applyLegacyImport(db, input, input.report.fingerprint);
  const restored = await new StateRepository(db).read('legacy-owner');
  assert.deepEqual(restored, { ...legacy.state, plan: 'free', planExpiresAt: null });
  assert.equal((await db.prepare('SELECT value FROM legacy_state_snapshots WHERE user_id=?').get('legacy-owner'))!.value, legacy.raw);
  assert.equal((await db.prepare('SELECT password FROM users WHERE id=?').get('legacy-owner'))!.password, null);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM sessions').get())!.count, 0);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM gifts').get())!.count, 0);
  await assert.rejects(applyLegacyImport(db, input, input.report.fingerprint), /already imported/);
  assert.throws(() => inspectLegacyImport(legacy.source, ['legacy-demo']), /must not be a demo/);
});
test('explicit imports preserve owned assessment progress and immutable content bytes without importing auth or demo authority',async t=>{
  const {db}=await fixture(t),legacy=await legacyFixture(t);
  const source=new DatabaseSync(legacy.source);
  const questions=quizQuestions.filter(question=>question.topic==='api-design').slice(0,2);
  const snapshot=JSON.stringify(questions.map(publishedQuestion));
  const version=createHash('sha256').update(snapshot).digest('hex'),sessionId=randomUUID();
  source.prepare('INSERT INTO content_versions(id,value) VALUES(?,?)').run(version,snapshot);
  source.prepare(`INSERT INTO assessment_sessions
    (id,user_id,topic,content_version,answers,revision,completed_at) VALUES(?,?,?,?,?,1,NULL)`)
    .run(sessionId,'legacy-owner','api-design',version,JSON.stringify({[questions[0].id]:questions[0].correct}));
  const state=JSON.parse(String(source.prepare('SELECT value FROM states WHERE user_id=?').get('legacy-owner')?.value)) as UserState;
  state.customQuizzes.push({id:'versioned-import-report',title:'Pinned historical fixture',topics:['api-design'],mode:'all',
    questionIds:questions.map(question=>question.id),answers:Object.fromEntries(questions.map(question=>[question.id,question.correct])),
    score:2,revision:3,createdAt:'2026-10-01',completedAt:'2026-10-02',contentVersion:version});
  source.prepare('UPDATE states SET value=? WHERE user_id=?').run(JSON.stringify(state,null,2),'legacy-owner');
  source.close();
  const inspected=inspectLegacyImport(legacy.source,['legacy-owner']);
  assert.equal(inspected.report.records.content_versions.imported,1);
  assert.equal(inspected.report.records.assessment_sessions.imported,1);
  await new ContentRepository(db).pin(questions);
  await applyLegacyImport(db,inspected,inspected.report.fingerprint);
  assert.equal((await db.prepare('SELECT value FROM content_versions WHERE id=?').get(version))!.value,snapshot);
  assert.equal((await new ContentRepository(db).sessionView('legacy-owner',sessionId)).answered,1);
  const restored=await new StateRepository(db).read('legacy-owner'),quiz=restored.customQuizzes[0];
  assert.equal(restored.plan,'free');
  const report=await new ContentRepository(db).report(quiz.id,quiz.answers,quiz.contentVersion,quiz.questionIds,quiz.score!);
  assert.deepEqual(report.questions,questions.map(publishedQuestion));
});

test('import validation fails on unknown fields and duplicate resource IDs rather than silently dropping values', async t => {
  const legacy = await legacyFixture(t);
  const db = new DatabaseSync(legacy.source);
  t.after(() => db.close());
  const write = (state: unknown) => db.prepare('UPDATE states SET value=? WHERE user_id=?').run(JSON.stringify(state), 'legacy-owner');
  write({ ...legacy.state, unknownFutureField: 'must not disappear' });
  assert.throws(() => inspectLegacyImport(legacy.source, ['legacy-owner']), /Unrecognized key/);
  write({ ...legacy.state, projects: [...legacy.state.projects, legacy.state.projects[0]] });
  assert.throws(() => inspectLegacyImport(legacy.source, ['legacy-owner']), /Duplicate resource identifiers/);
});

test('legacy import is all-or-nothing when a target account collides', async t => {
  const { db } = await fixture(t), legacy = await legacyFixture(t);
  const input = inspectLegacyImport(legacy.source, ['legacy-owner']);
  await db.prepare('INSERT INTO users (id,name,email,demo) VALUES (?,?,?,0)').run('legacy-owner', 'Existing Fixture', 'existing@example.invalid');
  await assert.rejects(applyLegacyImport(db, input, input.report.fingerprint), { code: '23505' });
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM legacy_imports').get())!.count, 0);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM legacy_state_snapshots').get())!.count, 0);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM project_workspaces').get())!.count, 0);
});
