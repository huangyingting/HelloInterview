import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Attempt, Bootstrap, UserState } from '../shared/types';

let mode: 'valid' | 'malformed' | 'unavailable' = 'valid';
let child: ChildProcess;
let origin = '';
let cookie = '';
let attempt: Attempt;
const dataDirectory = `data/ai-tests/${randomUUID()}`;
const requests: { model: string; messages: { role: string; content: string }[] }[] = [];
const provider = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] };
  requests.push(payload);
  res.setHeader('Content-Type', 'application/json');
  if (mode === 'unavailable') {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'Fixture provider unavailable.' }));
    return;
  }
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
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', HOST: '127.0.0.1', COOKIE_SECURE: 'false', DATA_DIR: dataDirectory, OPENAI_API_KEY: 'local-fixture-only', OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, OPENAI_MODEL: 'fixture-model' },
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
});
test('configured provider receives context and returns validated AI feedback and tutoring', async () => {
  const bootstrap = await api<Bootstrap>('/api/bootstrap');
  assert.equal(bootstrap.value.capabilities.ai, true);
  assert.equal(bootstrap.value.capabilities.aiModel, 'fixture-model');
  const evaluation = await api<UserState>(`/api/attempts/${attempt.id}/evaluate`, {});
  assert.equal(evaluation.response.status, 200);
  assert.equal(evaluation.value.attempts[0].feedback?.source, 'ai');
  assert.equal(evaluation.value.attempts[0].feedback?.score, 82);
  const chat = await api<UserState>('/api/tutor', { question: 'How should I choose cache freshness?', context: 'Caching lesson' });
  assert.equal(chat.response.status, 200);
  assert.equal(chat.value.chat.at(-1)?.source, 'ai');
  assert.match(chat.value.chat.at(-1)!.text, /Fixture AI tutor/);
  assert.equal(requests[0].model, 'fixture-model');
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
