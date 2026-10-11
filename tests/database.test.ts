import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emptyState } from '../shared/domain';
import { problems } from '../shared/catalog';
import type { Attempt, Bootstrap, Story, UserState } from '../shared/types';
import { loadConfig } from '../server/config';
import { openDatabase } from '../server/database';
import { postgresConnection, postgresParameters, sqliteConnection, type Database } from '../server/db/connection';
import { applyLegacyImport, inspectLegacyImport } from '../server/db/legacy-import';
import { assertDatabaseVersion, migrateDatabase, recordTables } from '../server/db/migrations';
import { StateRepository } from '../server/db/state-repository';
import { startServer } from '../server/runtime';

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
async function api<T>(url: string, route: string, body?: unknown, cookie = '', method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${url}${route}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, value: await response.json() as T };
}
async function runtime(t: TestContext, url: string) {
  const settings = loadConfig({ NODE_ENV: 'production', DATABASE_URL: url, DATA_DIR: path.join(await temporaryDirectory(t), 'untouched'), PORT: '0', LOG_REQUESTS: 'false' });
  const server = await startServer(settings);
  t.after(() => server.close());
  return server;
}
async function signup(url: string, email = `${randomUUID()}@example.invalid`) {
  const result = await api<{ user: { id: string } }>(url, '/api/auth/signup', { name: 'PostgreSQL Fixture', email, password: 'fixture-password-123' });
  assert.equal(result.response.status, 200);
  return { id: result.value.user.id, cookie: result.response.headers.get('set-cookie')!.split(';')[0] };
}

test('PostgreSQL parameter conversion preserves quoted literals and identifiers', () => {
  assert.equal(postgresParameters(`SELECT '?' AS "?", 'it''s ?' WHERE id=? AND name=?`), `SELECT '?' AS "?", 'it''s ?' WHERE id=$1 AND name=$2`);
});

test('controlled migrations are repeatable, serialize runners, and runtime rejects missing or changed history', async t => {
  const { db, url } = await fixture(t, false);
  await assert.rejects(assertDatabaseVersion(db), /migrations are missing/);
  const another = postgresConnection(url);
  t.after(() => another.close());
  await Promise.all([migrateDatabase(db), migrateDatabase(another)]);
  await assertDatabaseVersion(db);
  const rows = await db.prepare('SELECT version,checksum FROM schema_migrations').all();
  assert.equal(rows.length, 1);
  await db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run('corrupted-fixture');
  await assert.rejects(assertDatabaseVersion(db), /incompatible/);
  await assert.rejects(migrateDatabase(db), /history does not match/);
  await assert.rejects(runtime(t, url), /incompatible/);
});

test('SQLite async transactions serialize concurrent work, support nesting and roll back exactly', async t => {
  const db = sqliteConnection(openDatabase(await temporaryDirectory(t)));
  t.after(() => db.close());
  const id = await account(db);
  const states = new StateRepository(db);
  await Promise.all(Array.from({ length: 15 }, (_, index) => states.mutate(id, state => { state.bookmarks.push(`fixture-${index}`); })));
  assert.equal((await states.read(id)).bookmarks.length, 15);
  const before = await states.read(id);
  await assert.rejects(db.transaction(async () => {
    await states.mutate(id, state => { state.recognition += 4; });
    await db.transaction(async () => { throw new Error('Injected rollback'); });
  }), /Injected rollback/);
  assert.deepEqual(await states.read(id), before);
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

test('PostgreSQL API supports restart, relational DTO parity and atomic concurrent signup', async t => {
  const { db, url } = await fixture(t);
  const first = await runtime(t, url), second = await runtime(t, url);
  const email = 'signup-race@example.invalid';
  const responses = await Promise.all([first, second].map(server => api(server.url, '/api/auth/signup', { name: 'Race Fixture', email, password: 'fixture-password-123' })));
  assert.deepEqual(responses.map(result => result.response.status).sort(), [200, 409]);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM users WHERE email=?').get(email))!.count, 1);
  const authenticated = await signup(first.url);
  const target = await api<UserState>(first.url, '/api/targets', { company: 'Meta', level: 'Senior', role: 'Engineer', date: '' }, authenticated.cookie);
  assert.equal(target.response.status, 200);
  const post = await api<{ id: string }>(first.url, '/api/posts', { kind: 'discussion', title: 'PostgreSQL fixture discussion', body: 'A preserved community discussion with transactional recognition.', company: '', track: 'system-design', level: 'Senior', region: 'Global' }, authenticated.cookie);
  assert.equal(post.response.status, 201);
  await api(first.url, `/api/posts/${post.value.id}/vote`, {}, authenticated.cookie);
  const posts = await api<Record<string, unknown>[]>(second.url, '/api/posts?kind=discussion', undefined, authenticated.cookie);
  assert.equal(posts.value[0].authorId, authenticated.id);
  assert.equal(posts.value[0].voted, true);
  assert.equal(posts.value[0].votes, 1);
  assert.equal(typeof posts.value[0].createdAt, 'string');
  await api(first.url, '/api/comments', { resource: 'fixture-resource', body: 'Fixture comment is persisted.' }, authenticated.cookie);
  const comments = await api<Record<string, unknown>[]>(second.url, '/api/comments?resource=fixture-resource');
  assert.equal(typeof comments.value[0].createdAt, 'string');
  assert.equal(comments.value[0].parentId, null);
  const before = await api<Bootstrap>(first.url, '/api/bootstrap', undefined, authenticated.cookie);
  await first.close();
  const restarted = await runtime(t, url);
  assert.deepEqual((await api<Bootstrap>(restarted.url, '/api/bootstrap', undefined, authenticated.cookie)).value, before.value);
});

test('attempt and story edits enforce revisions across instances and never move attempts between problems', async t => {
  const { url } = await fixture(t);
  const first = await runtime(t, url), second = await runtime(t, url), user = await signup(first.url);
  const created = await api<{ attempt: Attempt }>(first.url, '/api/attempts', { problemId: 'short-links', level: 'Senior', answer: 'A saved explanation of a database invariant and API.', code: '', nodes: [], edges: [], elapsed: 1 }, user.cookie);
  const input = created.value.attempt;
  const edits = await Promise.all([first, second].map((server, index) => api<{ attempt: Attempt }>(server.url, '/api/attempts', { ...input, answer: `Saved version ${index}: database and endpoint design.` }, user.cookie)));
  assert.deepEqual(edits.map(result => result.response.status).sort(), [200, 409]);
  const latest = (await api<Bootstrap>(first.url, '/api/bootstrap', undefined, user.cookie)).value.state.attempts[0];
  assert.equal(latest.revision, 1);
  const otherProblem = problems.find(problem => problem.id !== latest.problemId && !problem.premium)!;
  assert.equal((await api(first.url, '/api/attempts', { ...latest, problemId: otherProblem.id }, user.cookie)).response.status, 400);
  assert.equal((await api(first.url, '/api/attempts', { ...latest, revision: undefined }, user.cookie)).response.status, 400);
  const story = { title: 'Fixture STAR story', situation: 'Context', task: 'Task', action: 'Action', result: 'Result', tags: [] };
  const savedStory = await api<UserState>(first.url, '/api/stories', story, user.cookie);
  const existing = savedStory.value.stories[0];
  const storyEdits = await Promise.all([first, second].map(server => api<Story>(server.url, '/api/stories', { ...existing, title: 'Updated fixture story' }, user.cookie)));
  assert.deepEqual(storyEdits.map(result => result.response.status).sort(), [200, 409]);
});

test('gift redemption is one-use across replicas and rolls back its financial-looking demo flag on write failure', async t => {
  const { db, url } = await fixture(t);
  const first = await runtime(t, url), second = await runtime(t, url);
  const users = await Promise.all([signup(first.url), signup(second.url)]);
  const gift = await api<{ code: string }>(first.url, '/api/gift', { plan: 'year' }, users[0].cookie);
  const redeemed = await Promise.all([first, second].map((server, index) => api<UserState>(server.url, '/api/gift/redeem', { code: gift.value.code }, users[index].cookie)));
  assert.deepEqual(redeemed.map(result => result.response.status).sort(), [200, 400]);
  assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM user_settings WHERE plan='year'").get())!.count, 1);
  const next = await api<{ code: string }>(first.url, '/api/gift', { plan: 'month' }, users[0].cookie);
  await db.exec("CREATE FUNCTION fail_state_update() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''Injected state failure''; END'; CREATE TRIGGER state_failure BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION fail_state_update()");
  t.mock.method(console, 'error', () => undefined);
  assert.equal((await api(second.url, '/api/gift/redeem', { code: next.value.code }, users[1].cookie)).response.status, 500);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM gifts WHERE redeemed_by IS NULL').get())!.count, 1);
  await db.exec('DROP TRIGGER state_failure ON user_settings');
  assert.equal((await api(second.url, '/api/gift/redeem', { code: next.value.code }, users[1].cookie)).response.status, 200);
});

test('premium mocks, project snapshots and study reflections reject concurrent stale edits in PostgreSQL', async t => {
  const { url } = await fixture(t);
  const first = await runtime(t, url), second = await runtime(t, url), user = await signup(first.url);
  const servers = [first, second];
  await api(first.url, '/api/plan', { plan: 'year' }, user.cookie);
  const createdMock = await api<{ session: { id: string } }>(first.url, '/api/mocks', { problemId: 'short-links', company: 'Meta', level: 'Senior', length: 3 }, user.cookie);
  const drafts = await Promise.all(servers.map(server => api(server.url, `/api/mocks/${createdMock.value.session.id}/draft`, { revision: 0, answer: 'A saved mock draft about API and database constraints.' }, user.cookie)));
  assert.deepEqual(drafts.map(result => result.response.status).sort(), [200, 409]);
  const createdProject = await api<{ project: { id: string } }>(first.url, '/api/projects', { title: 'Concurrent project', problemId: 'event-dedup', files: [{ path: 'events.js', content: '  // baseline\r\n' }] }, user.cookie);
  const projectId = createdProject.value.project.id;
  const saves = await Promise.all(servers.map(server => api(server.url, `/api/projects/${projectId}/save`, { revision: 0, files: [{ path: 'events.js', content: '  // changed\r\n' }], explanation: '', verification: '' }, user.cookie)));
  assert.deepEqual(saves.map(result => result.response.status).sort(), [200, 409]);
  const plan = await api<{ plan: { id: string; tasks: { id: string; kind: string }[] } }>(first.url, '/api/study-plans', { company: 'Meta', level: 'Senior', weeks: 2, sessionsPerWeek: 5, startOn: '2026-10-08' }, user.cookie);
  assert.equal(plan.response.status, 200);
  const reflection = plan.value.plan.tasks.find(task => task.kind === 'reflection');
  assert.ok(reflection);
  const reflections = await Promise.all(servers.map(server => api(server.url, `/api/study-plans/${plan.value.plan.id}/reflection`, { revision: 0, taskId: reflection.id, note: 'A preserved reflection about the next practice session.' }, user.cookie)));
  assert.deepEqual(reflections.map(result => result.response.status).sort(), [200, 409]);
  const saved = (await api<Bootstrap>(first.url, '/api/bootstrap', undefined, user.cookie)).value.state;
  assert.equal(saved.projects[0].files[0].original, '  // baseline\r\n');
  assert.equal(saved.projects[0].files[0].content, '  // changed\r\n');
  assert.equal(saved.studyPlans[0].revision, 1);
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
  const directory = await temporaryDirectory(t), db = openDatabase(directory);
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
  return { source: path.join(directory, 'studio.sqlite'), raw, state };
}

test('explicit import dry run preserves bytes, excludes demo authority, reconciles every record and rejects replay', async t => {
  const { db } = await fixture(t);
  const legacy = await legacyFixture(t);
  const bytes = await readFile(legacy.source);
  const input = inspectLegacyImport(legacy.source, ['legacy-owner']);
  assert.equal(input.report.excludedDemoUsers, 1);
  assert.equal(input.report.skippedSessions, 1);
  assert.equal(input.report.skippedGifts, 1);
  assert.equal(input.report.records.posts.excluded, 12);
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
