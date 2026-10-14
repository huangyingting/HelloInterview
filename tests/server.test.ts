import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createApplication } from '../server/application';
import { loadConfig } from '../server/config';
import { startServer } from '../server/runtime';
import { createApp, handleError } from '../server/app';
import { localConnection } from '../server/db/connection';
import type { Bootstrap, UserState } from '../shared/types';

const execute = promisify(execFile);

async function temporaryDirectory(t: TestContext) {
  const parent = path.resolve('data/server-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function config(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  return loadConfig({ NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, LOG_REQUESTS: 'false', ...env });
}

async function api<T>(url: string, route: string, body?: unknown, cookie = '') {
  const response = await fetch(`${url}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, value: await response.json() as T };
}

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('production runtime serves built assets, SPA routes and unchanged API error boundaries', async t => {
  const runtime = await startServer(config(await temporaryDirectory(t)));
  t.after(() => runtime.close());
  const health = await api(runtime.url, '/api/health');
  assert.deepEqual(health.value, { status: 'ok' });
  const expectedHtml = await readFile('dist/index.html', 'utf8');
  for (const route of ['/', '/learn/system-design', '/premium/projects', '/dist-server/index.js']) {
    const response = await fetch(`${runtime.url}${route}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/html/);
    assert.equal(await response.text(), expectedHtml);
  }
  const asset = expectedHtml.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset);
  const script = await fetch(`${runtime.url}${asset}`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type')!, /javascript/);
  assert.match(script.headers.get('cache-control')??'',/immutable/);
  const missingAsset=await fetch(`${runtime.url}/assets/missing-release-chunk.js`);
  assert.equal(missingAsset.status,404);assert.match(missingAsset.headers.get('content-type')??'',/text\/plain/);
  assert.equal(await missingAsset.text(),'Asset not found.');
  const bootstrap = await api<Bootstrap>(runtime.url, '/api/bootstrap');
  assert.equal(bootstrap.response.headers.get('cache-control'), 'no-store');
  assert.equal(bootstrap.value.user, null);
  assert.deepEqual(bootstrap.value.capabilities, { ai: false, commerce: 'demo', community: 'local', aiModel: null, fieldMetrics: false });
  assert.equal((await api(runtime.url, '/api/not-an-endpoint')).response.status, 404);
  for (const route of ['/.cred', '/.env', '/data/studio.sqlite', '/.git/config']) {
    assert.equal((await fetch(`${runtime.url}${route}`)).status, 404);
  }
  const denied = await fetch(`${runtime.url}/api/auth/demo`, { method: 'POST', headers: { Origin: 'https://unrelated.example' } });
  assert.equal(denied.status, 403);
  const malformed = await fetch(`${runtime.url}/api/auth/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'Invalid JSON request.' });
  const address=await fetch(`${runtime.url}/learn/%E0%A4`,{headers:{Accept:'text/html'}});
  assert.equal(address.status,400);assert.equal(await address.text(),expectedHtml);assert.equal(address.headers.get('cache-control'),'no-store');
  for(const route of ['/api/community/posts/%E0%A4?kind=questions','/auth/%','/assets/%']){
    const invalid=await fetch(`${runtime.url}${route}`,{headers:{Accept:'text/html'}});
    assert.equal(invalid.status,400);assert.match(invalid.headers.get('content-type') ?? '',/json/);assert.deepEqual(await invalid.json(),{error:'Invalid address encoding.'});
  }
});

test('field performance telemetry is opt-in, privacy-bounded, normalized and rate-limited', async t => {
  const disabled = await startServer(config(await temporaryDirectory(t)));
  t.after(() => disabled.close());
  assert.equal((await fetch(`${disabled.url}/api/metrics/web-vitals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metric: 'LCP', value: 2512.4, screen: 'practice', navigation: 'navigate' }),
  })).status, 404);

  const logs: string[] = [], original = console.log;
  console.log = (...values: unknown[]) => { logs.push(values.map(String).join(' ')); };
  t.after(() => { console.log = original; });
  const runtime = await startServer(config(await temporaryDirectory(t), { FIELD_METRICS_ENABLED: 'true' }));
  t.after(() => runtime.close());
  const bootstrap = await api<Bootstrap>(runtime.url, '/api/bootstrap');
  assert.equal(bootstrap.value.capabilities.fieldMetrics, true);
  const payload = { metric: 'LCP', value: 2512.4, screen: 'practice', navigation: 'navigate' };
  assert.equal((await fetch(`${runtime.url}/api/metrics/web-vitals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })).status, 403);
  const accepted = await fetch(`${runtime.url}/api/metrics/web-vitals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: runtime.url }, body: JSON.stringify(payload),
  });
  assert.equal(accepted.status, 204);
  const event = JSON.parse(logs.at(-1)!) as Record<string, unknown>;
  assert.deepEqual(event, {
    event: 'web_vital.observed', metric: 'LCP', value: 2510,
    rating: 'needs-improvement', screen: 'practice', navigation: 'navigate',
  });
  const rejected = await fetch(`${runtime.url}/api/metrics/web-vitals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: runtime.url },
    body: JSON.stringify({ ...payload, url: '/practice/private-answer?token=secret' }),
  });
  assert.equal(rejected.status, 400);
  assert.ok(!logs.join('\n').includes('private-answer'));
  for (let index = 1; index < 60; index++) {
    assert.equal((await fetch(`${runtime.url}/api/metrics/web-vitals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: runtime.url }, body: JSON.stringify(payload),
    })).status, 204);
  }
  assert.equal((await fetch(`${runtime.url}/api/metrics/web-vitals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: runtime.url }, body: JSON.stringify(payload),
  })).status, 429);
  assert.equal(logs.filter(line => line.includes('web_vital.observed')).length, 60);
});

test('production runtime serves explicitly retained hashed assets behind current assets',async t=>{
  const root=await temporaryDirectory(t),retained=path.join(root,'previous');
  await mkdir(path.join(retained,'assets'),{recursive:true});
  await writeFile(path.join(retained,'assets','old-route-deadbeef.js'),'export const retained=true;');
  await writeFile(path.join(retained,'assets',path.basename((await readFile('dist/index.html','utf8')).match(/src="([^"]+\.js)"/)![1])),'stale current collision');
  const runtime=await startServer(config(await temporaryDirectory(t),{RETAINED_FRONTEND_DIRS:retained}));
  t.after(()=>runtime.close());
  const old=await fetch(`${runtime.url}/assets/old-route-deadbeef.js`);
  assert.equal(old.status,200);assert.equal(await old.text(),'export const retained=true;');assert.match(old.headers.get('cache-control')??'',/immutable/);
  const currentPath=(await readFile('dist/index.html','utf8')).match(/src="([^"]+\.js)"/)![1];
  const current=await fetch(`${runtime.url}${currentPath}`);
  assert.notEqual(await current.text(),'stale current collision');
});

test('production startup rejects a missing retained frontend release',async t=>{
  const directory=await temporaryDirectory(t);
  await assert.rejects(()=>createApplication(config(directory,{RETAINED_FRONTEND_DIRS:'/missing/studio-release'})),/Retained frontend assets are missing/);
});

test('independent application instances isolate accounts and configuration while persisting saved state', async t => {
  const firstConfig = config(await temporaryDirectory(t));
  const secondConfig = config(await temporaryDirectory(t), { COOKIE_SECURE: 'true', OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'fixture-model' });
  let first = await startServer(firstConfig);
  const second = await startServer(secondConfig);
  t.after(async () => { await first.close(); await second.close(); });
  const login = await api(first.url, '/api/auth/signup', { name: 'Runtime Fixture', email: 'runtime-fixture@example.invalid', password: 'fixture-password-123' });
  assert.equal(login.response.status, 200);
  const cookieHeader = login.response.headers.get('set-cookie')!;
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.ok(!cookieHeader.includes('Secure'));
  const cookie = cookieHeader.split(';')[0];
  const target = await api<UserState>(first.url, '/api/targets', { company: 'Meta', level: 'Senior', role: 'Engineer', date: '2026-11-01' }, cookie);
  assert.equal(target.response.status, 200);
  const before = await api<Bootstrap>(first.url, '/api/bootstrap', undefined, cookie);
  const other = await api<Bootstrap>(second.url, '/api/bootstrap', undefined, cookie);
  assert.equal(other.value.user, null);
  assert.equal(other.value.state.targets.length, 0);
  assert.equal(other.value.capabilities.aiModel, 'fixture-model');
  assert.ok(!JSON.stringify(other.value).includes('fixture-only'));
  const secondLogin = await api(second.url, '/api/auth/demo', {});
  assert.match(secondLogin.response.headers.get('set-cookie')!, /;\s*Secure/);
  await first.close();
  first = await startServer(firstConfig);
  const after = await api<Bootstrap>(first.url, '/api/bootstrap', undefined, cookie);
  assert.deepEqual(after.value, before.value);
});

test('missing built frontend fails before opening or creating the database', async t => {
  const root = await temporaryDirectory(t);
  const settings = loadConfig({ NODE_ENV: 'production', DATA_DIR: 'untouched-data' }, root);
  await assert.rejects(createApplication(settings), /production frontend is missing.*npm run build/);
  await assert.rejects(stat(settings.dataDir), { code: 'ENOENT' });
});

test('invalid CLI configuration exits nonzero before touching data and does not expose secret values', async t => {
  const dataDir = path.join(await temporaryDirectory(t), 'untouched-data');
  await assert.rejects(execute(process.execPath, ['dist-server/index.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: 'invalid-port', DATA_DIR: dataDir, OPENAI_API_KEY: 'fixture-secret-not-for-logs' },
  }), error => {
    assert.ok(error instanceof Error && 'code' in error && error.code === 1 && 'stderr' in error);
    const stderr = String(error.stderr);
    assert.match(stderr, /Studio startup failed: PORT must be an integer/);
    assert.ok(!stderr.includes('fixture-secret-not-for-logs'));
    return true;
  });
  await assert.rejects(stat(dataDir), { code: 'ENOENT' });
});

test('a listen failure cleans up application resources and permits a subsequent start', async t => {
  const occupying = createServer();
  await listen(occupying);
  t.after(() => closeServer(occupying));
  const address = occupying.address();
  assert.ok(address && typeof address === 'object');
  const dataDir = await temporaryDirectory(t);
  await assert.rejects(startServer(config(dataDir, { PORT: String(address.port) })), { code: 'EADDRINUSE' });
  const runtime = await startServer(config(dataDir));
  t.after(() => runtime.close());
  assert.equal((await api(runtime.url, '/api/health')).response.status, 200);
});

test('graceful shutdown drains an in-flight AI request and repeated close calls share one operation', async t => {
  let respond: (() => void) | undefined;
  let observed: (() => void) | undefined;
  const provider = createServer((req, res) => {
    req.resume();
    respond = () => res.end(JSON.stringify({ choices: [{ message: { content: 'Fixture tutor response after draining.' } }] }));
    observed?.();
  });
  const providerUrl = await listen(provider);
  t.after(() => closeServer(provider));
  const runtime = await startServer(config(await temporaryDirectory(t), { OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: `${providerUrl}/v1` }));
  t.after(() => runtime.close());
  const login = await api(runtime.url, '/api/auth/demo', {});
  const cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  const received = new Promise<void>(resolve => { observed = resolve; });
  const pending = api<UserState>(runtime.url, '/api/tutor', { question: 'How should a graceful shutdown preserve this question?' }, cookie);
  await received;
  const closing = runtime.close();
  assert.equal(runtime.close(), closing);
  respond!();
  const result = await pending;
  assert.equal(result.response.status, 200);
  assert.match(result.value.chat.at(-1)!.text, /after draining/);
  await closing;
  assert.equal(runtime.server.listening, false);
});

test('application disposal cancels in-flight provider calls without writing to a closed database', async t => {
  let observed: (() => void) | undefined;
  const provider = createServer(req => {
    req.resume();
    observed?.();
  });
  const providerUrl = await listen(provider);
  t.after(() => closeServer(provider));
  const settings = config(await temporaryDirectory(t), { OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: `${providerUrl}/v1` });
  const application = await createApplication(settings);
  const server = createServer(application.app);
  const url = await listen(server);
  t.after(async () => { await closeServer(server); await application.close(); });
  const login = await api(url, '/api/auth/demo', {});
  const cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  const before = await api<Bootstrap>(url, '/api/bootstrap', undefined, cookie);
  const received = new Promise<void>(resolve => { observed = resolve; });
  const pending = api<{ error: string }>(url, '/api/tutor', { question: 'The saved state must remain intact if the provider never answers.' }, cookie);
  await received;
  await application.close();
  const result = await pending;
  assert.equal(result.response.status, 503);
  assert.match(result.value.error, /shutting down.*saved work is unchanged/);
  const restarted = await startServer(settings);
  t.after(() => restarted.close());
  const after = await api<Bootstrap>(restarted.url, '/api/bootstrap', undefined, cookie);
  assert.deepEqual(after.value, before.value);
});

test('shutdown enforces the grace deadline and aborts a provider that never answers', { timeout: 20000 }, async t => {
  let observed: (() => void) | undefined;
  const provider = createServer(req => {
    req.resume();
    observed?.();
  });
  const providerUrl = await listen(provider);
  t.after(() => closeServer(provider));
  const runtime = await startServer(config(await temporaryDirectory(t), { OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: `${providerUrl}/v1` }));
  t.after(() => runtime.close());
  const login = await api(runtime.url, '/api/auth/demo', {});
  const cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  const received = new Promise<void>(resolve => { observed = resolve; });
  const pending = api(runtime.url, '/api/tutor', { question: 'A stalled provider must not prevent the Studio from shutting down.' }, cookie);
  const rejected = assert.rejects(pending, TypeError);
  await received;
  const logs: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  const started = Date.now();
  await runtime.close();
  await rejected;
  assert.ok(Date.now() - started < 15000);
  assert.equal(runtime.server.listening, false);
  assert.ok(logs.some(message => message.includes('10-second grace period')));
});

test('readiness requires a live database while liveness remains independent of database outages', async t => {
  const db = localConnection(await temporaryDirectory(t));
  t.after(() => db.close());
  const settings = config(await temporaryDirectory(t));
  const app = createApp(settings, db, new AbortController().signal);
  app.use(handleError);
  const server = createServer(app), url = await listen(server);
  t.after(() => closeServer(server));
  assert.deepEqual((await api(url, '/api/ready')).value, { status: 'ready', mode: 'local' });
  await db.close();
  t.mock.method(console, 'error', () => undefined);
  assert.equal((await api(url, '/api/ready')).response.status, 503);
  assert.equal((await api(url, '/api/health')).response.status, 200);
});

test('application draining rejects new work without aborting the in-flight request grace period', async t => {
  const application = await createApplication(config(await temporaryDirectory(t)));
  const server = createServer(application.app), url = await listen(server);
  t.after(async () => { await closeServer(server); await application.close(); });
  assert.equal((await api(url, '/api/ready')).response.status, 200);
  application.drain();
  assert.equal((await api(url, '/api/ready')).response.status, 503);
  assert.equal((await api(url, '/api/auth/demo', {})).response.status, 503);
});

test('trusted HTTPS proxy origin is canonical and forwarded protocol is ignored from untrusted peers', async t => {
  const trusted = await startServer(config(await temporaryDirectory(t), { PUBLIC_ORIGIN: 'https://studio.example', COOKIE_SECURE: 'true', TRUST_PROXY: '127.0.0.1' }));
  const untrusted = await startServer(config(await temporaryDirectory(t), { PUBLIC_ORIGIN: 'https://studio.example', COOKIE_SECURE: 'true' }));
  t.after(async () => { await trusted.close(); await untrusted.close(); });
  function proxyPost(url: string, headers: Record<string, string>) {
    return new Promise<{ status: number | undefined; cookies: string[] }>((resolve, reject) => {
      const req = httpRequest(`${url}/api/auth/demo`, { method: 'POST', headers }, res => {
        res.resume();
        res.once('end', () => resolve({ status: res.statusCode, cookies: res.headers['set-cookie'] ?? [] }));
      });
      req.once('error', reject);
      req.end();
    });
  }
  const headers = { Host: 'studio.example:443', 'X-Forwarded-Proto': 'https', Origin: 'https://studio.example' };
  const allowed = await proxyPost(trusted.url, headers);
  assert.equal(allowed.status, 200);
  assert.match(allowed.cookies[0], /;\s*Secure/);
  assert.equal((await proxyPost(untrusted.url, headers)).status, 421);
  assert.equal((await proxyPost(trusted.url, { ...headers, Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await proxyPost(trusted.url, { ...headers, Host: 'wrong.example' })).status, 421);
  assert.equal((await api(untrusted.url, '/api/ready')).response.status, 200);
});

test('request telemetry uses server IDs and route templates, never bodies, cookies, emails or query strings', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  const runtime = await startServer(config(await temporaryDirectory(t), { LOG_REQUESTS: 'true' }));
  t.after(() => runtime.close());
  const response = await fetch(`${runtime.url}/api/auth/signup?token=fixture-query-secret`, {
    method: 'POST',
    headers: { 'X-Request-ID': 'untrusted-id', Cookie: 'fixture-cookie-secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Telemetry Fixture', email: 'fixture-private-email@example.invalid', password: 'fixture-private-password-123' }),
  });
  assert.equal(response.status, 200);
  const requestId = response.headers.get('x-request-id')!;
  assert.match(requestId, /^[a-f0-9-]{36}$/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const entries = logs.map(line => JSON.parse(line) as Record<string, unknown>);
  const completed = entries.find(entry => entry.requestId === requestId)!;
  assert.equal(completed.event, 'request.completed');
  assert.equal(completed.route, '/api/auth/:action');
  assert.equal(completed.status, 200);
  assert.equal(typeof completed.durationMs, 'number');
  for (const privateValue of ['fixture-query-secret', 'fixture-cookie-secret', 'fixture-private-email', 'fixture-private-password', 'untrusted-id']) {
    assert.ok(!logs.join('').includes(privateValue));
  }
});
