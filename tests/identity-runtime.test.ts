import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { openIdentityFixture } from './fixtures/identity';

test('runtime-only compiled release authenticates through HTTPS OIDC and retains owned identity/session state after restart', { timeout: 120000 }, async t => {
  const f = await openIdentityFixture({}, { brokerHostname: '127.0.0.1' });
  const release = await mkdtemp(join(tmpdir(), 'studio-identity-release-'));
  let stop: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await stop?.(); } finally {
      try { await f.close(); } finally { await rm(release, { recursive: true, force: true }); }
    }
  });
  await Promise.all([
    cp('package.json', join(release, 'package.json')),
    cp('package-lock.json', join(release, 'package-lock.json')),
    cp('dist', join(release, 'dist'), { recursive: true }),
    cp('dist-server', join(release, 'dist-server'), { recursive: true }),
  ]);
  await promisify(execFile)('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: release, timeout: 60000 });
  for (const dependency of ['tsx', 'typescript', 'vite', 'esbuild']) await assert.rejects(stat(join(release, 'node_modules', dependency)), { code: 'ENOENT' });
  async function start() {
    const child = spawn(process.execPath, ['dist-server/index.js'], {
      cwd: release, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0',
        DATABASE_URL: f.config.databaseUrl!, PUBLIC_ORIGIN: f.origin, COOKIE_SECURE: 'true',
        TRUST_PROXY: '127.0.0.1/32', LOG_REQUESTS: 'false',
        OIDC_ISSUER: f.issuer, OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-client-secret',
        NODE_EXTRA_CA_CERTS: f.certificatePath,
      },
    });
    const exited = once(child, 'exit');
    stop = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const [code, signal] = await exited;
      assert.equal(code, 0); assert.equal(signal, null);
    };
    let stdout = '', stderr = '';
    child.stderr.on('data', value => { stderr += String(value); });
    const address = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Compiled managed runtime did not become ready: ${stderr}`)), 15000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Compiled managed runtime exited (${code}): ${stderr}`)); });
      child.stdout.on('data', value => {
        stdout += String(value);
        const address = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (address) { clearTimeout(timeout); resolve(address); }
      });
    });
    f.proxyTo(address);
    assert.equal((await fetch(`${address}/api/ready`)).status, 200);
  }
  await start();
  const browser = f.browser(), authorization = await f.begin(browser);
  assert.equal((await f.complete(browser, authorization)).headers.get('location'), '/account');
  const before = await browser.bootstrap();
  assert.equal(before.user?.identity?.status, 'active');
  assert.equal((await browser.request('/api/profile', { name: 'Compiled member' }, 'PATCH')).status, 200);
  assert.equal((await browser.security()).identities.length, 1);
  await stop!();
  await start();
  const after = await browser.bootstrap();
  assert.equal(after.user?.id, before.user?.id);
  assert.equal(after.user?.name, 'Compiled member');
  assert.equal(after.user?.identity?.verified, true);
  assert.equal((await browser.request('/api/auth/demo', {})).status, 404);
  assert.equal((await browser.request('/api/logout', {})).status, 200);
  assert.equal((await browser.bootstrap()).user, null);
});
