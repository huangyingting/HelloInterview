import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Entitlements, type GrantRequest } from '../server/entitlements';
import { StateRepository } from '../server/db/state-repository';
import { DurableJobs, migrateJobs, TerminalJobFailure } from '../server/jobs';
import { HttpError } from '../server/http-error';
import { createApplication } from '../server/application';
import { problems, getTrack } from '../shared/catalog';
import { courses } from '../shared/public-catalog';
import type { Bootstrap, ProjectWorkspace, UserState } from '../shared/types';
import { openIdentityFixture } from './fixtures/identity';
import { completedPrivacyExport } from './fixtures/privacy';

async function fixture(t: TestContext) {
  const f = await openIdentityFixture();
  t.after(() => f.close());
  const browser = f.browser();
  assert.equal((await f.complete(browser, await f.begin(browser))).status, 303);
  assert.equal((await browser.bootstrap()).user?.identity?.status, 'active');
  const data = await browser.bootstrap();
  assert.ok(data.user);
  return { ...f, browser, owner: data.user.id, entitlements: new Entitlements(f.db) };
}
function grant(owner: string, policy: GrantRequest['policy'] = 'pro-v1', key: string = randomUUID(), startsAt = Date.now() - 1000, endsAt = Date.now() + 60000): GrantRequest {
  return { owner, source: { kind: 'engineering', key }, policy, startsAt, endsAt, evidence: { actor: 'fixture-operator', reason: 'Synthetic entitlement contract rehearsal only.' } };
}
const denied = (error: unknown) => error instanceof HttpError && [403, 409].includes(error.status);
async function value<T>(response: Response): Promise<T> {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('replicas issue immutable source grants exactly once, reject conflicts and keep revocation terminal', async t => {
  const f = await fixture(t), second = await f.replica(), two = new Entitlements(second.db);
  const request = grant(f.owner);
  const issued = await Promise.all([f.entitlements.issue(request), two.issue(request), f.entitlements.issue(request)]);
  assert.ok(issued.every(row => row.id === issued[0].id));
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM entitlement_events').get())?.count, 1);
  await assert.rejects(two.issue({ ...request, endsAt: request.endsAt + 1 }), denied);
  await assert.rejects(two.issue({ ...request, evidence: { ...request.evidence, reason: 'A conflicting synthetic adjustment request.' } }), denied);
  await Promise.all([f.entitlements.revoke(f.owner, request.source, request.evidence), two.revoke(f.owner, request.source, request.evidence)]);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM entitlement_events').get())?.count, 2);
  assert.equal((await f.entitlements.issue(request)).revoked, true);
  assert.equal(await two.allows(f.owner, 'mock.create'), false);
  const late = grant(f.owner);
  await two.revoke(f.owner, late.source, late.evidence);
  assert.equal((await f.entitlements.issue(late)).revoked, true);
  assert.equal(await f.entitlements.allows(f.owner, 'content.premium.read'), false);
});

test('independent sources union permissions, scheduled/expired intervals are inactive and account restrictions override grants', async t => {
  const f = await fixture(t), pro = grant(f.owner), read = grant(f.owner, 'premium-read-v1');
  await f.entitlements.issue(pro); await f.entitlements.issue(read);
  assert.equal((await f.entitlements.view(f.owner)).state, 'pro');
  assert.equal(await f.entitlements.allows(f.owner, 'ai.feedback.consume'), false);
  await f.entitlements.revoke(f.owner, pro.source, pro.evidence);
  const view = await f.entitlements.view(f.owner);
  assert.equal(view.state, 'read-only');
  assert.equal(await f.entitlements.allows(f.owner, 'content.premium.read'), true);
  assert.equal(await f.entitlements.allows(f.owner, 'learning.premium.write'), false);
  assert.equal(await f.entitlements.allows(f.owner, 'tutor.premium.use'), false);
  await f.db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(f.owner);
  assert.ok((await f.entitlements.view(f.owner)).features.every(feature => !feature.allowed && feature.reason === 'restricted'));
  await f.db.prepare("UPDATE managed_accounts SET status='pending-verification',contact_verified=0 WHERE user_id=?").run(f.owner);
  assert.equal((await f.entitlements.view(f.owner)).state, 'restricted');
  await f.db.prepare("UPDATE managed_accounts SET status='active',contact_verified=1 WHERE user_id=?").run(f.owner);
  await f.entitlements.revoke(f.owner, read.source, read.evidence);
  const future = grant(f.owner, 'pro-v1', randomUUID(), Date.now() + 60000, Date.now() + 120000);
  const past = grant(f.owner, 'pro-v1', randomUUID(), Date.now() - 60000, Date.now() - 1);
  await f.entitlements.issue(future); await f.entitlements.issue(past);
  const scheduled = await f.entitlements.view(f.owner);
  assert.equal(scheduled.state, 'free');
  assert.equal(scheduled.nextChangeAt, new Date(future.startsAt).toISOString());
  assert.equal(scheduled.features.find(feature => feature.key === 'mock.create')?.reason, 'scheduled');
  assert.equal(await f.entitlements.allows(f.owner, 'archive.own.export'), true);
  await assert.rejects(f.entitlements.issue({ ...future, endsAt: future.startsAt }), /finite service interval/);
  await assert.rejects(f.entitlements.issue({ ...future, endsAt: future.startsAt + 86400001 }), /finite service interval/);
});

test('source ownership remains global and permanent when the original account and grants are deleted', async t => {
  const f = await fixture(t), other = (await f.replica()).browser();
  assert.equal((await f.complete(other, await f.begin(other, 'github'), { sub: 'github|second-owner', email: 'second@example.invalid' })).headers.get('location'), '/account');
  const otherOwner = (await other.bootstrap()).user;
  assert.ok(otherOwner);
  const source = grant(f.owner);
  await f.entitlements.issue(source);
  await assert.rejects(f.entitlements.issue({ ...source, owner: otherOwner.id }), denied);
  await f.db.exec(`CREATE SEQUENCE owner_deletion_witness;
    CREATE FUNCTION pause_owner_deletion() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('owner_deletion_witness'); PERFORM pg_sleep(0.5); RETURN OLD; END $body$;
    CREATE TRIGGER pause_owner_deletion AFTER DELETE ON users FOR EACH ROW EXECUTE FUNCTION pause_owner_deletion();`);
  const deletion = f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);
  const deadline = Date.now() + 5000;
  while (!(await f.db.prepare('SELECT is_called FROM owner_deletion_witness').get())?.is_called && Date.now() < deadline) await delay(10);
  assert.equal((await f.db.prepare('SELECT is_called FROM owner_deletion_witness').get())?.is_called, true);
  await assert.rejects(f.entitlements.issue({ ...source, owner: otherOwner.id }), denied);
  await deletion;
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM entitlement_grants').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT user_id FROM entitlement_revocations WHERE source_key=?').get(source.source.key))?.user_id, f.owner);
  await assert.rejects(f.entitlements.issue({ ...source, owner: otherOwner.id }), denied);
});

test('all grants determine access even when minimized displayed source history is truncated', async t => {
  const f = await fixture(t);
  const active = grant(f.owner);
  const issued = await f.entitlements.issue(active);
  for (let index = 0; index < 51; index++) {
    await f.entitlements.issue(grant(f.owner, 'premium-read-v1', `future-${index}`, Date.now() + 120000, Date.now() + 180000));
  }
  const view = await f.entitlements.view(f.owner);
  assert.equal(view.sources.length, 50); assert.equal(view.sourceHistoryTruncated, true);
  assert.equal(view.state, 'pro');
  assert.equal(view.sources.some(source => source.id === issued.id), false);
  assert.doesNotMatch(JSON.stringify(view), /source_key|future-|fixture-operator|request_hash|Synthetic entitlement/);
});

test('managed route matrix separates content, writes, archives and fake demo commerce across replicas', async t => {
  const f = await fixture(t), replica = await f.replica(), browser = replica.browser();
  browser.cookies.set('__Host-studio_session', f.browser.cookies.get('__Host-studio_session')!);
  browser.cookies.set('__Host-studio_csrf', f.browser.cookies.get('__Host-studio_csrf')!);
  await browser.bootstrap();
  const states = new StateRepository(f.db);
  await states.mutate(f.owner, state => { state.plan = 'lifetime'; state.planExpiresAt = null; });
  const premiumProblem = problems.find(problem => problem.premium)!;
  const premiumCourse = courses.find(course => course.premium && course.units.some(unit => unit.steps.some(step => step.type === 'video')))!;
  assert.ok(premiumProblem); assert.ok(premiumCourse);
  const video = premiumCourse.units.flatMap(unit => unit.steps).find(step => step.type === 'video')!;
  const contentRoutes = ['/api/content/lessons/system-design/replication', `/api/content/problems/${premiumProblem.id}`,
    `/api/content/references/${premiumProblem.id}`, `/api/content/media/${premiumCourse.id}/${video.resource}.webm`, `/api/content/media/${premiumCourse.id}/${video.resource}.vtt`];
  for (const path of contentRoutes) assert.equal((await browser.request(path)).status, 403, path);
  for (const path of ['/api/plan', '/api/gift', '/api/gift/redeem', '/api/auth/demo', '/api/profile/password', '/api/entitlements']) {
    assert.equal((await browser.request(path, { plan: 'lifetime', code: 'FAKE', policy: 'pro-v1' })).status, 404, path);
  }
  const read = grant(f.owner, 'premium-read-v1');
  await f.entitlements.issue(read);
  for (const path of contentRoutes) assert.equal((await browser.request(path)).status, 200, path);
  assert.equal((await browser.request(contentRoutes[3], undefined, 'GET', { Range: 'bytes=0-15' })).status, 206);
  const writes: [string, unknown][] = [
    ['/api/progress', { field: 'read', key: 'system-design/replication', enabled: true }],
    [`/api/courses/${premiumCourse.id}/enroll`, {}], [`/api/courses/${premiumCourse.id}/video`, { resource: video.resource }],
    [`/api/courses/${premiumCourse.id}/certificate`, {}],
    ['/api/attempts', { problemId: premiumProblem.id, level: 'Senior', answer: 'A sufficiently long synthetic explanation.' }],
    ['/api/mocks', { problemId: premiumProblem.id, company: 'Meta', level: 'Senior', length: 3 }],
    ['/api/custom-quizzes', { title: 'Synthetic quiz', topics: ['api-design'], mode: 'all', count: 1 }],
    ['/api/study-plans', { company: 'Meta', level: 'Senior', weeks: 2, sessionsPerWeek: 3, startOn: '2026-10-12' }],
    ['/api/projects', { title: 'Synthetic project', problemId: 'event-dedup', files: [{ path: 'main.js', content: 'function solve(input) { return input; }' }] }],
  ];
  for (const [path, body] of writes) assert.equal((await browser.request(path, body)).status, 403, path);
  assert.equal((await browser.request('/api/progress', { field: 'read', key: 'system-design/introduction', enabled: true })).status, 200);
  const premiumLesson = getTrack('system-design')!.lessons.find(lesson => lesson.id === 'replication')!;
  const helper = await value<UserState>(await browser.request('/api/tutor', { question: premiumLesson.title + ' ' + premiumLesson.summary }));
  assert.equal(helper.chat.some(message => message.text.includes(premiumLesson.sections[0].body)), false);
  const pro = grant(f.owner);
  await f.entitlements.issue(pro);
  for (const [path, body] of writes.filter(([path]) => !path.endsWith('/video') && !path.endsWith('/certificate'))) {
    assert.equal((await browser.request(path, body)).status, 200, path);
  }
  assert.equal((await browser.request(`/api/courses/${premiumCourse.id}/video`, { resource: video.resource })).status, 200);
  const paidHelper = await value<UserState>(await browser.request('/api/tutor', { question: premiumLesson.title + ' ' + premiumLesson.summary }));
  assert.ok(paidHelper.chat.some(message => message.text.includes(premiumLesson.sections[0].body)));
  const before = await browser.bootstrap();
  const mock = before.state.mocks[0], quiz = before.state.customQuizzes[0], project = before.state.projects[0], plan = before.state.studyPlans[0], attempt = before.state.attempts[0];
  assert.ok(project.brief && project.briefVersion);
  await f.entitlements.revoke(f.owner, pro.source, pro.evidence);
  await f.entitlements.revoke(f.owner, read.source, read.evidence);
  const continuation: [string, unknown][] = [
    [`/api/mocks/${mock.id}/draft`, { revision: mock.revision, answer: 'A saved synthetic answer.' }],
    [`/api/mocks/${mock.id}/respond`, { revision: mock.revision }],
    [`/api/custom-quizzes/${quiz.id}/answer`, { revision: quiz.revision, questionId: quiz.questionIds[0], answer: 0 }],
    [`/api/custom-quizzes/${quiz.id}/finish`, { revision: quiz.revision }],
    [`/api/projects/${project.id}/save`, { revision: project.revision, files: project.files, explanation: '', verification: '' }],
    [`/api/projects/${project.id}/review`, { revision: project.revision }],
    [`/api/study-plans/${plan.id}/reflection`, { revision: plan.revision, taskId: 'unknown', note: 'A synthetic reflection.' }],
    [`/api/attempts/${attempt.id}/evaluate`, {}],
  ];
  for (const [path, body] of continuation) assert.equal((await browser.request(path, body)).status, 403, path);
  const archived = await value<Bootstrap>(await browser.request('/api/bootstrap'));
  assert.deepEqual(archived.state.projects, before.state.projects);
  assert.equal((await browser.request(`/api/custom-quizzes/${quiz.id}/question`)).status, 200);
  assert.equal((await browser.request(`/api/content/problems/${project.problemId}?project=${project.id}`)).status, 200);
  assert.equal((await browser.request(`/api/content/problems/${project.problemId}?project=${randomUUID()}`)).status, 404);
  const exported = await completedPrivacyExport(browser,f.privacy);
  assert.deepEqual((exported.artifact.preparation as {state:UserState}).state.projects, before.state.projects);
  assert.doesNotMatch(JSON.stringify(exported), /source_key|request_hash|fixture-operator/);
});

test('paid expiry after an actual SQL write rolls back publication and preserves the archive', async t => {
  const f = await fixture(t), request = grant(f.owner, 'pro-v1', randomUUID(), Date.now() - 1000, Date.now() + 1500);
  await f.entitlements.issue(request);
  const premiumCourse = courses.find(course => course.premium)!;
  await f.db.exec(`CREATE SEQUENCE paid_write_witness;
    CREATE FUNCTION pause_paid_write() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF NEW.kind='enrollments' THEN PERFORM nextval('paid_write_witness'); PERFORM pg_sleep(2); END IF;
      RETURN NEW;
    END $body$;
    CREATE TRIGGER pause_paid_write AFTER INSERT ON user_resources FOR EACH ROW EXECUTE FUNCTION pause_paid_write();`);
  const response = await f.browser.request(`/api/courses/${premiumCourse.id}/enroll`, {});
  assert.equal(response.status, 403);
  assert.equal((await f.db.prepare('SELECT is_called FROM paid_write_witness').get())?.is_called, true, 'The real domain insert must happen before expiry; admission denial is not sufficient evidence.');
  assert.equal((await new StateRepository(f.db).read(f.owner)).enrollments.includes(premiumCourse.id), false);
  assert.equal((await f.entitlements.view(f.owner)).features.find(feature => feature.key === 'mock.create')?.reason, 'expired');
});

test('project archives keep the licensed original brief, never a later library update, and diagnose unversioned work', async t => {
  const f = await fixture(t), source = grant(f.owner);
  await f.entitlements.issue(source);
  const problem = problems.find(problem => problem.track === 'ai-coding' && problem.premium)!;
  assert.ok(problem);
  const result = await value<{ project: ProjectWorkspace }>(await f.browser.request('/api/projects', { title: 'Pinned task fixture', problemId: problem.id, files: [{ path: 'main.js', content: 'fixture' }] }));
  const description = problem.description;
  problem.description = 'A later protected library revision.';
  t.after(() => { problem.description = description; });
  await f.entitlements.revoke(f.owner, source.source, source.evidence);
  const response = await f.browser.request(`/api/content/problems/${problem.id}?project=${result.project.id}`);
  const brief = await value<ProjectWorkspace['brief']>(response);
  assert.equal(brief?.description, description);
  assert.doesNotMatch(JSON.stringify(brief), /"keywords"|"workedCase"|"solution"/);
  assert.equal(response.headers.get('x-content-version'), result.project.briefVersion);
  assert.equal((await f.browser.request(`/api/content/problems/${problem.id}`)).status, 403);
  const states = new StateRepository(f.db);
  await states.mutate(f.owner, state => { delete state.projects[0].brief; delete state.projects[0].briefVersion; });
  assert.equal((await f.browser.request(`/api/content/problems/${problem.id}?project=${result.project.id}`)).status, 409);
  assert.equal((await completedPrivacyExport(f.browser,f.privacy)).item.status,'ready');
});

test('managed AI is denied at enqueue and existing local claims cannot publish after identity adoption', async t => {
  const f = await fixture(t);
  await migrateJobs(f.db);
  const jobs = await DurableJobs.open(f.db, true);
  f.cleanup.push(() => jobs.close());
  const request = { principal: { type: 'user', id: f.owner } as const, kind: 'ai.evaluate' as const, key: 'synthetic-ai', resource: 'draft:synthetic', payload: { synthetic: true }, retryMode: 'idempotent' as const };
  await assert.rejects(jobs.enqueue({ ...request, principal: { type: 'system', id: 'synthetic-system' } }), denied);
  await assert.rejects(jobs.enqueue(request), denied);
  const account = await f.db.prepare('SELECT * FROM managed_accounts WHERE user_id=?').get(f.owner);
  assert.ok(account);
  assert.equal(typeof account.contact_email, 'string'); assert.equal(typeof account.contact_identity_id, 'string');
  await f.db.prepare('DELETE FROM managed_accounts WHERE user_id=?').run(f.owner);
  const operation = await jobs.enqueue(request), claim = await jobs.claim('ai.evaluate');
  assert.ok(claim);
  const queued = await jobs.enqueue({ ...request, key: 'synthetic-ai-dispatch', resource: 'draft:synthetic-dispatch' });
  await f.db.prepare(`INSERT INTO managed_accounts (user_id,status,contact_email,contact_identity_id,contact_verified)
    VALUES (?,?,?,?,?)`).run(f.owner, 'active', String(account.contact_email), String(account.contact_identity_id), 1);
  let mutated = false;
  await assert.rejects(jobs.finish(claim, async () => { mutated = true; return { synthetic: true }; }), error => error instanceof TerminalJobFailure && error.code === 'not-eligible');
  assert.equal(mutated, false);
  assert.equal((await jobs.operation(operation.id)).completedAt, null);
  let dispatched = false;
  await jobs.startWorkers({ 'ai.evaluate': async () => { dispatched = true; return async () => ({ synthetic: true }); } });
  const deadline = Date.now() + 10000;
  while ((await jobs.ownedStatus(f.owner, queued.id)).status !== 'failed' && Date.now() < deadline) await delay(50);
  assert.equal((await jobs.ownedStatus(f.owner, queued.id)).status, 'failed');
  assert.equal(dispatched, false);
});

test('worker permission loss after actual business SQL rolls back the result, receipt and account change', async t => {
  const f = await fixture(t);
  await migrateJobs(f.db);
  const jobs = await DurableJobs.open(f.db);
  f.cleanup.push(() => jobs.close());
  const operation = await jobs.enqueue({ principal: { type: 'user', id: f.owner }, kind: 'notification.deliver', key: 'final-permission-check',
    resource: 'synthetic-notification', payload: { synthetic: true }, retryMode: 'idempotent' });
  const claim = await jobs.claim('notification.deliver');
  assert.ok(claim);
  let wrote = false;
  await assert.rejects(jobs.finish(claim, async db => {
    await db.prepare('UPDATE user_settings SET recognition=99 WHERE user_id=?').run(f.owner);
    await db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(f.owner);
    wrote = true;
    return { synthetic: true };
  }), error => error instanceof TerminalJobFailure && error.code === 'not-eligible');
  assert.equal(wrote, true);
  assert.equal((await f.db.prepare('SELECT recognition FROM user_settings WHERE user_id=?').get(f.owner))?.recognition, 0);
  assert.equal((await f.db.prepare('SELECT status FROM managed_accounts WHERE user_id=?').get(f.owner))?.status, 'active');
  assert.equal((await jobs.operation(operation.id)).completedAt, null);
});

test('stored entitlement authority refuses unconfigured local-demo startup rather than silently changing authorization', async t => {
  const f = await fixture(t);
  await f.entitlements.issue(grant(f.owner));
  await assert.rejects(createApplication({ ...f.config, identity: null }), /Stored managed entitlements require managed identity/);
});
