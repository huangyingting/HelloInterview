import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Attempt, Bootstrap, MockSession, ProjectWorkspace, UserState } from '../shared/types';

let mode: 'valid' | 'malformed' | 'unavailable' | 'delayed' = 'valid';
let releaseProvider: (() => void) | undefined;
let observeProvider: (() => void) | undefined;
let child: ChildProcess;
let origin = '';
let cookie = '';
let attempt: Attempt;
const dataDirectory = `data/ai-tests/${randomUUID()}`;
const requests: { model?: string; messages: { role: string; content: string }[];url:string;apiKey:string|null }[] = [];
const provider = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body) as { model?: string; messages: { role: string; content: string }[] };
  requests.push({...payload,url:req.url??'',apiKey:typeof req.headers['api-key']==='string'?req.headers['api-key']:null});
  res.setHeader('Content-Type', 'application/json');
  if (mode === 'unavailable') {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'Fixture provider unavailable.' }));
    return;
  }
  if (mode === 'delayed') await new Promise<void>(resolve => { releaseProvider = resolve; observeProvider?.(); });
  const coaching = payload.messages[0].content.includes('engineering interview coach');
  const content = coaching ? JSON.stringify(mode === 'malformed' ? { score: 1000 } : { score: 82, strengths: ['Explicit datastore invariant.'], improvements: ['Explain the cache invalidation path.'], summary: 'Fixture AI coaching response.' }) : 'Fixture AI tutor: choose a freshness budget and measure backend load.';
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
async function api<T>(route: string, body?: unknown) {
  const response = await fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, value: await response.json() as T };
}
async function startApplication() {
  const address = provider.address();
  assert.ok(address && typeof address === 'object');
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', PORT: '0', HOST: '127.0.0.1', COOKIE_SECURE: 'false', DATA_DIR: dataDirectory, AZURE_OPENAI_API_KEY: 'local-fixture-only', AZURE_OPENAI_ENDPOINT: `http://127.0.0.1:${address.port}`, AZURE_OPENAI_DEPLOYMENT: 'fixture-model',AZURE_OPENAI_API_VERSION:'2025-04-01-preview' };
  delete env.DATABASE_URL;
  env.LOG_REQUESTS = 'false';
  env.APP_MODE = 'local';
  delete env.PUBLIC_ORIGIN;
  delete env.TRUST_PROXY;
  child = spawn(process.execPath, ['dist-server/index.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture application startup timed out.')), 20000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture application exited (${code}).`)); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout!.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { origin = match[0]; clearTimeout(timeout); resolve(); }
    });
  });
}
async function stopApplication() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
}
before(async () => {
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  await startApplication();
  const login = await api('/api/auth/demo', {});
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  const created = await api<{ attempt: Attempt }>('/api/attempts', { problemId: 'short-links', level: 'Senior', answer: 'Use a clear API endpoint and an atomic database invariant to create unique identifiers. Explain retries and use a bounded cache for redirects.', code: '', nodes: [], edges: [], elapsed: 1 });
  attempt = created.value.attempt;
});
after(async () => {
  await stopApplication();
  await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  await rm(dataDirectory, { recursive: true, force: true });
});
test('configured provider receives context and returns validated AI feedback and tutoring', async () => {
  const bootstrap = await api<Bootstrap>('/api/bootstrap');
  assert.equal(bootstrap.value.capabilities.ai, true);
  assert.equal(bootstrap.value.capabilities.aiModel, 'fixture-model');
  const evaluation = await api<UserState>(`/api/attempts/${attempt.id}/evaluate`, {});
  assert.equal(evaluation.response.status, 200);
  assert.equal(evaluation.value.attempts[0].feedback?.source, 'ai');
  assert.equal(evaluation.value.attempts[0].feedback?.score, 82);
  attempt = evaluation.value.attempts.find(saved => saved.id === attempt.id)!;
  const chat = await api<UserState>('/api/tutor', { question: 'How should I choose cache freshness?', context: 'Caching lesson' });
  assert.equal(chat.response.status, 200);
  assert.equal(chat.value.chat.at(-1)?.source, 'ai');
  assert.match(chat.value.chat.at(-1)!.text, /Fixture AI tutor/);
  assert.equal(requests[0].model,undefined);
  assert.equal(requests[0].apiKey,'local-fixture-only');
  assert.equal(requests[0].url,'/openai/deployments/fixture-model/chat/completions?api-version=2025-04-01-preview');
  assert.match(requests.at(-1)!.messages[1].content, /Caching lesson/);
});
test('malformed upstream feedback is a provider error and never becomes rubric success', async () => {
  mode = 'malformed';
  const updated = await api('/api/attempts', { ...attempt, answer: 'This is a changed and saved answer whose feedback must not be fabricated if the provider returns invalid fields.' });
  assert.equal(updated.response.status, 200);
  const evaluation = await api<{ error: string }>(`/api/attempts/${attempt.id}/evaluate`, {});
  assert.equal(evaluation.response.status, 502);
  assert.match(evaluation.value.error, /invalid feedback fields/);
  const bootstrap = await api<Bootstrap>('/api/bootstrap');
  assert.equal(bootstrap.value.state.attempts[0].completed, false);
  assert.equal(bootstrap.value.state.attempts[0].feedback, undefined);
});
test('upstream outage is explicit and leaves persisted drafts and chat unchanged', async () => {
  mode = 'unavailable';
  const before = await api<Bootstrap>('/api/bootstrap');
  const chat = await api<{ error: string }>('/api/tutor', { question: 'A question while the provider is unavailable.' });
  assert.equal(chat.response.status, 502);
  assert.match(chat.value.error, /503/);
  const after = await api<Bootstrap>('/api/bootstrap');
  assert.deepEqual(after.value.state.chat, before.value.state.chat);
  assert.equal(after.value.state.attempts[0].answer, before.value.state.attempts[0].answer);
});
test('SQLite sessions, drafts and tutoring history survive an application restart', async () => {
  const before = await api<Bootstrap>('/api/bootstrap');
  await stopApplication();
  await startApplication();
  const after = await api<Bootstrap>('/api/bootstrap');
  assert.equal(after.response.status, 200);
  assert.deepEqual(after.value.user, before.value.user);
  assert.deepEqual(after.value.state, before.value.state);
});
test('premium mock and project grading use the configured provider without fabricating execution', async () => {
  mode = 'valid';
  assert.equal((await api('/api/plan', { plan: 'year' })).response.status, 200);
  const created = await api<{ session: MockSession }>('/api/mocks', { problemId: 'job-scheduler', company: 'Meta', level: 'Staff', length: 3 });
  const id = created.value.session.id;
  const saved = await api<UserState>(`/api/mocks/${id}/draft`, { revision: 0, answer: 'A queue partition retries work with backoff, and metrics reveal processing lag.' });
  const revision = saved.value.mocks.find(m => m.id === id)!.revision;
  const evaluated = await api<UserState>(`/api/mocks/${id}/respond`, { revision });
  assert.equal(evaluated.response.status, 200);
  assert.equal(evaluated.value.mocks[0].turns[0].feedback.source, 'ai');
  assert.match(evaluated.value.mocks[0].question, /lease/);
  const project = await api<{ project: ProjectWorkspace }>('/api/projects', { title: 'Fixture project', problemId: 'event-dedup', files: [{ path: 'events.js', content: 'function solve(input) { return input; }\n' }] });
  const projectId = project.value.project.id;
  const projectSave = await api<UserState>(`/api/projects/${projectId}/save`, { revision: 0, files: [{ path: 'events.js', content: 'function solve(input) { const seen = new Set(); return input.filter(e => !seen.has(e.id) && seen.add(e.id)); }\n' }], explanation: 'A Set keeps first events in order without mutating the original input array.', verification: 'User-reported browser examples; integration behavior not verified.' });
  const review = await api<UserState>(`/api/projects/${projectId}/review`, { revision: projectSave.value.projects[0].revision });
  assert.equal(review.response.status, 200);
  assert.equal(review.value.projects[0].feedback?.source, 'ai');
  assert.match(requests.at(-1)!.messages[1].content, /User-reported verification/);
  assert.match(requests.at(-1)!.messages[1].content, /do not claim you executed tests/);
});
test('late provider responses cannot overwrite a newer mock draft or revive ended access', { timeout: 15000 }, async () => {
  for (const change of ['draft', 'access']) {
    mode = 'valid';
    await api('/api/plan', { plan: 'year' });
    const created = await api<{ session: MockSession }>('/api/mocks', { problemId: 'short-links', company: 'Meta', level: 'Senior', length: 3 }), id = created.value.session.id;
    await api(`/api/mocks/${id}/draft`, { revision: 0, answer: 'The original answer describes a database, an API endpoint, a cache and a unique identifier.' });
    const observed = new Promise<void>(resolve => { observeProvider = resolve; });
    mode = 'delayed';
    const pending = api<{ error: string }>(`/api/mocks/${id}/respond`, { revision: 1 });
    await observed;
    try {
      if (change === 'draft') {
        const newer = await api(`/api/mocks/${id}/draft`, { revision: 1, answer: 'A newer answer must remain unchanged when the old provider response arrives.' });
        assert.equal(newer.response.status, 200);
      } else {
        const reset = await fetch(`${origin}/api/plan`, { method: 'DELETE', headers: { Cookie: cookie } });
        assert.equal(reset.status, 200);
      }
    } finally { mode = 'valid'; releaseProvider?.(); }
    const response = await pending;
    assert.equal(response.response.status, change === 'draft' ? 409 : 403);
    const bootstrap = await api<Bootstrap>('/api/bootstrap'), saved = bootstrap.value.state.mocks.find(m => m.id === id)!;
    assert.equal(saved.turns.length, 0);
    assert.ok(saved.draft.length > 30);
  }
});
test('premium mocks, project baselines, custom quiz sessions and plans survive a process restart', async () => {
  mode = 'valid';
  await api('/api/plan', { plan: 'year' });
  await api('/api/custom-quizzes', { title: 'Persisted fixture quiz', topics: ['api-design'], mode: 'all', count: 2 });
  await api('/api/study-plans', { company: 'Meta', level: 'Staff', weeks: 2, sessionsPerWeek: 5, startOn: '2026-10-08' });
  const before = await api<Bootstrap>('/api/bootstrap');
  assert.ok(before.value.state.mocks.length && before.value.state.projects.length && before.value.state.customQuizzes.length && before.value.state.studyPlans.length);
  await stopApplication();
  await startApplication();
  const after = await api<Bootstrap>('/api/bootstrap');
  assert.deepEqual(after.value.user, before.value.user);
  assert.deepEqual(after.value.state, before.value.state);
});
