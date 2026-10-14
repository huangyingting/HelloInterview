import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { openIdentityFixture } from './fixtures/identity';
import { Entitlements } from '../server/entitlements';

test('runtime-only release retains identity after restart and operates canonical reconciliation, backlog failure and the compiled worker', { timeout: 120000 }, async t => {
  const f = await openIdentityFixture({}, { brokerHostname: '127.0.0.1', lifecycle: true });
  const release = await mkdtemp(join(tmpdir(), 'studio-identity-release-'));
  const settings = f.config.identity?.lifecycle;
  assert.ok(settings); assert.ok(f.lifecycle);
  const databaseUrl = f.config.databaseUrl;
  assert.ok(databaseUrl);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, NODE_ENV: 'production', APP_MODE: 'service', HOST: '127.0.0.1', PORT: '0',
    DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: f.origin, COOKIE_SECURE: 'true',
    TRUST_PROXY: '127.0.0.1/32', LOG_REQUESTS: 'true',
    OIDC_ISSUER: f.issuer, OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-client-secret',
    OIDC_INVITED_EMAILS: 'owner@example.invalid',
    OIDC_MANAGEMENT_ORIGIN: settings.origin, OIDC_MANAGEMENT_CLIENT_ID: settings.clientId,
    OIDC_MANAGEMENT_CLIENT_SECRET: settings.clientSecret, OIDC_PASSWORD_HOOK_SECRET: settings.hookSecret,
    NODE_EXTRA_CA_CERTS: f.certificatePath,
  };
  let stop: (() => Promise<void>) | undefined, stopWorker: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await stopWorker?.(); } finally {
      try { await stop?.(); } finally {
        try { await f.close(); } finally { await rm(release, { recursive: true, force: true }); }
      }
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
  assert.ok((await stat(join(release, 'dist-server/billing/cli.js'))).isFile());
  await assert.rejects(promisify(execFile)(process.execPath, ['dist-server/billing/cli.js', 'reconcile'], { cwd: release, env, timeout: 15000 }), error => {
    assert.ok(error && typeof error === 'object' && 'code' in error && 'stderr' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /Sandbox billing maintenance failed/);
    return true;
  });
  async function start() {
    const child = spawn(process.execPath, ['dist-server/index.js'], {
      cwd: release, stdio: ['ignore', 'pipe', 'pipe'],
      env,
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
    const ready = await fetch(`${address}/api/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready', mode: 'service' });
  }
  await start();
  const browser = f.browser(), authorization = await f.begin(browser);
  assert.equal((await f.complete(browser, authorization)).headers.get('location'), '/account');
  const before = await browser.bootstrap();
  assert.ok(before.user);
  assert.equal(before.user?.identity?.status, 'active');
  assert.equal(before.capabilities.ai, false);
  assert.equal(before.capabilities.commerce, 'disabled');
  assert.equal(before.capabilities.community, 'read-only');
  assert.equal((await browser.request('/api/profile', { name: 'Compiled member' }, 'PATCH')).status, 200);
  assert.equal((await browser.security()).identities.length, 1);
  const supportInput = { key: randomUUID(), email: 'compiled-support@example.invalid',
    body: 'A private saved support request from the runtime-only compiled release.' };
  const supportResponse = await browser.request('/api/support', supportInput);
  assert.equal(supportResponse.status, 200);
  const supportReceipt: unknown = await supportResponse.json();
  const communityPost=randomUUID(),communityBody='An independently addressable, saved community post in the runtime-only release.';
  await f.db.prepare('INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)')
    .run(communityPost,'questions','Compiled community question',communityBody,'Fixture Company','system-design','Senior','Global','Private compiled name',before.user.id,new Date().toISOString());
  const publicDetail=await browser.request(`/api/community/posts/${communityPost}?kind=questions`);
  assert.equal(publicDetail.status,200);
  const privateSafePost=await publicDetail.json();
  assert.equal(privateSafePost.isMine,true);assert.equal(privateSafePost.author,'Anonymous');assert.equal(privateSafePost.body,communityBody);
  assert.ok(!JSON.stringify(privateSafePost).includes(before.user.id));assert.ok(!Object.hasOwn(privateSafePost,'authorId'));
  const addressedDetail=await browser.request(`/api/community/post?${new URLSearchParams({id:communityPost,kind:'questions'})}`);
  assert.equal(addressedDetail.status,200);assert.deepEqual(await addressedDetail.json(),privateSafePost);
  const entitlements = new Entitlements(f.db);
  const grant = { owner: before.user.id, source: { kind: 'engineering' as const, key: 'compiled-access-fixture' }, policy: 'pro-v1' as const,
    startsAt: Date.now() - 1000, endsAt: Date.now() + 300000, evidence: { actor: 'compiled-fixture', reason: 'Runtime-only synthetic access rehearsal.' } };
  await entitlements.issue(grant);
  assert.equal((await browser.request('/api/content/lessons/system-design/replication')).status, 200);
  assert.equal((await f.db.prepare("SELECT attempts FROM identity_abuse_buckets WHERE scope='network'").get())?.attempts, 2);
  await stop!();
  await start();
  const after = await browser.bootstrap();
  assert.equal(after.user?.id, before.user?.id);
  assert.equal(after.user?.name, 'Compiled member');
  assert.equal(after.user?.identity?.verified, true);
  assert.equal(after.capabilities.access?.state, 'pro');
  const replayedSupport = await browser.request('/api/support', supportInput);
  assert.equal(replayedSupport.status, 200); assert.deepEqual(await replayedSupport.json(), supportReceipt);
  const supportHistory = await browser.request('/api/support/requests');
  assert.equal(supportHistory.status, 200);
  assert.deepEqual((await supportHistory.json()).tickets, [supportReceipt]);
  const communityFeed=await browser.request('/api/community/posts?kind=questions&q=independently&scope=mine');
  assert.equal(communityFeed.status,200);assert.deepEqual((await communityFeed.json()).posts,[privateSafePost]);
  assert.equal((await browser.request(`/api/community/posts/${communityPost}`,{})).status,503);
  assert.equal((await browser.request('/api/posts/actions',{id:communityPost,action:'vote',enabled:true})).status,503);
  assert.equal((await browser.request(`/api/posts/owned?${new URLSearchParams({id:communityPost})}`)).status,503);
  assert.equal((await browser.request('/api/posts/owned',{id:communityPost,revision:0,title:'Compiled writes remain denied',body:'The compiled managed release must preserve the read-only boundary.'},'PUT')).status,503);
  assert.equal((await browser.request('/api/posts/owned',{id:communityPost,revision:0},'DELETE')).status,503);
  assert.equal((await browser.request(`/api/comments/owned?${new URLSearchParams({id:communityPost})}`)).status,503);
  assert.equal((await browser.request('/api/comments/owned',{id:communityPost,revision:0,body:'Compiled managed comment editing remains disabled.'},'PUT')).status,503);
  const discussionPage=await browser.request(`/api/comments/page?${new URLSearchParams({resource:`post/${communityPost}`})}`);
  assert.equal(discussionPage.status,200);assert.deepEqual(await discussionPage.json(),{comments:[],limit:50,nextCursor:null});
  assert.equal((await browser.request('/api/comments/page',{resource:`post/${communityPost}`})).status,503);
  await entitlements.revoke(grant.owner, grant.source, grant.evidence);
  assert.equal((await browser.request('/api/content/lessons/system-design/replication')).status, 403);
  assert.equal((await f.db.prepare("SELECT attempts FROM identity_abuse_buckets WHERE scope='network'").get())?.attempts, 2);
  await f.begin(browser);
  assert.equal((await f.db.prepare("SELECT attempts FROM identity_abuse_buckets WHERE scope='network'").get())?.attempts, 3);
  assert.equal((await browser.request('/api/auth/demo', {})).status, 404);

  const subject = await f.db.prepare('SELECT subject FROM managed_identities').get();
  assert.equal(typeof subject?.subject, 'string');
  f.setProfile(String(subject?.subject), { last_password_reset: new Date(Date.now() - 1500).toISOString() });
  const reconciled = await promisify(execFile)(process.execPath, ['dist-server/identity/cli.js', 'reconcile'], { cwd: release, env, timeout: 15000 });
  assert.deepEqual(JSON.parse(reconciled.stdout), { event: 'identity.reconciliation.completed', completed: 1 });
  assert.equal((await browser.bootstrap()).user, null);

  const second = f.browser(), secondSubject = 'auth0|compiled-worker-reset';
  assert.equal((await f.complete(second, await f.begin(second, 'email'), { sub: secondSubject })).headers.get('location'), '/account');
  assert.ok((await second.bootstrap()).user);
  f.setProfile(secondSubject, { last_password_reset: new Date(Date.now() - 1500).toISOString() });
  await f.lifecycle.enqueueSweep();
  const held = await f.lifecycle.jobs.claim('identity.reconcile');
  assert.ok(held);
  await assert.rejects(promisify(execFile)(process.execPath, ['dist-server/identity/cli.js', 'reconcile'], { cwd: release, env, timeout: 15000 }), error => {
    assert.ok(error && typeof error === 'object' && 'code' in error && 'stdout' in error);
    assert.equal(error.code, 1);
    assert.ok(!String(error.stdout).includes('identity.reconciliation.completed'));
    return true;
  });
  assert.equal(await f.lifecycle.jobs.fail(held), true);
  const worker = spawn(process.execPath, ['dist-server/identity/cli.js', 'worker'], { cwd: release, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const workerExited = once(worker, 'exit');
  let diagnostics = '';
  worker.stderr.on('data', value => { diagnostics += String(value); });
  stopWorker = async () => {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGTERM');
    const [code, signal] = await workerExited;
    assert.equal(code, 0, diagnostics); assert.equal(signal, null);
  };
  const deadline = Date.now() + 15000;
  while (true) {
    const [bootstrap,operation]=await Promise.all([second.bootstrap(),f.lifecycle.jobs.operation(held.data.operationId)]);
    if(!bootstrap.user&&operation.completedAt)break;
    assert.equal(worker.exitCode, null, diagnostics);
    assert.ok(Date.now() < deadline, `The compiled worker did not reconcile: ${diagnostics}`);
    await delay(200);
  }
  await stopWorker();
  await assert.rejects(promisify(execFile)(process.execPath, ['dist-server/index.js'], {
    cwd: release, timeout: 15000, env: { ...env,
      OIDC_MANAGEMENT_ORIGIN: undefined, OIDC_MANAGEMENT_CLIENT_ID: undefined,
      OIDC_MANAGEMENT_CLIENT_SECRET: undefined, OIDC_PASSWORD_HOOK_SECRET: undefined,
    },
  }), { code: 1 });
  assert.equal((await browser.request('/api/logout', {})).status, 200);
  assert.equal((await browser.bootstrap()).user, null);
});
