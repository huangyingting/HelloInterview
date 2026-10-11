import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Bootstrap } from '../shared/types';

test('the compiled release runs with runtime-only dependencies, loads .env, persists data and handles SIGTERM', { timeout: 120000 }, async t => {
  const parent = path.resolve('data/runtime-tests');
  await mkdir(parent, { recursive: true });
  const release = await mkdtemp(path.join(parent, 'release-'));
  let stop: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await stop?.(); }
    finally { await rm(release, { recursive: true, force: true }); }
  });
  await Promise.all([
    cp('package.json', path.join(release, 'package.json')),
    cp('package-lock.json', path.join(release, 'package-lock.json')),
    cp('dist', path.join(release, 'dist'), { recursive: true }),
    cp('dist-server', path.join(release, 'dist-server'), { recursive: true }),
  ]);
  await promisify(execFile)('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: release, timeout: 60000 });
  for (const dependency of ['tsx', 'vite', 'typescript', 'esbuild']) {
    await assert.rejects(stat(path.join(release, 'node_modules', dependency)), { code: 'ENOENT' });
  }
  await assert.rejects(promisify(execFile)(process.execPath, ['dist-server/db/cli.js', 'migrate'], {
    cwd: release, env: { NODE_ENV: 'test' },
  }), error => {
    assert.ok(error instanceof Error && 'code' in error && error.code === 1 && 'stderr' in error);
    assert.match(String(error.stderr), /DATABASE_URL is required/);
    return true;
  });
  await writeFile(path.join(release, '.env'), 'HOST=127.0.0.1\nPORT=0\nDATA_DIR=private-data\nCOOKIE_SECURE=false\nOPENAI_API_KEY=\nOPENAI_MODEL=fixture-model\n');
  async function start() {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
    for (const key of ['HOST', 'PORT', 'DATA_DIR', 'DATABASE_URL', 'APP_MODE', 'PUBLIC_ORIGIN', 'TRUST_PROXY', 'LOG_REQUESTS', 'COOKIE_SECURE', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']) delete env[key];
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist-server/index.js'], { cwd: release, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    stop = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const [code, signal] = await exited;
      assert.equal(code, 0);
      assert.equal(signal, null);
    };
    let stdout = '', stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    return new Promise<string>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Runtime startup timed out: ${stderr}`)), 15000);
      child.once('error', error => { clearTimeout(deadline); reject(error); });
      child.once('exit', code => { clearTimeout(deadline); reject(new Error(`Runtime exited before readiness (${code}): ${stderr}`)); });
      child.stdout.on('data', chunk => {
        stdout += String(chunk);
        const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(deadline); resolve(match[0]); }
      });
    });
  }
  let url = await start();
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
  assert.equal(await (await fetch(`${url}/dashboard`)).text(), await readFile(path.join(release, 'dist/index.html'), 'utf8'));
  const login = await fetch(`${url}/api/auth/demo`, { method: 'POST' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const plan=await fetch(`${url}/api/plan`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({plan:'month'})});
  assert.equal(plan.status,200);
  const paidMedia=await fetch(`${url}/api/content/media/concurrency/concurrency.webm`,{headers:{Cookie:cookie,Range:'bytes=0-127'}});
  assert.equal(paidMedia.status,206);
  assert.equal((await paidMedia.arrayBuffer()).byteLength,128);
  const freeMedia=await fetch(`${url}/api/content/media/system-design/system-design.webm`);
  assert.equal(freeMedia.status,200);
  assert.match(freeMedia.headers.get('content-type')!,/video\/webm/);
  const before = await (await fetch(`${url}/api/bootstrap`, { headers: { Cookie: cookie } })).json() as Bootstrap;
  assert.ok(before.user);
  assert.equal(before.capabilities.ai, false);
  await stat(path.join(release, 'private-data/studio.sqlite'));
  await stop!();
  url = await start();
  const after = await (await fetch(`${url}/api/bootstrap`, { headers: { Cookie: cookie } })).json() as Bootstrap;
  assert.deepEqual(after, before);
  await stop!();
});
