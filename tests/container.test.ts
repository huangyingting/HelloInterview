import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { Bootstrap } from '../shared/types';

const execute = promisify(execFile);
async function docker(...args: string[]) {
  return execute('docker', args, { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
}

test('container release is non-root, runtime-only, read-only compatible and persistent across restart', { timeout: 240000 }, async t => {
  const id = randomUUID().replaceAll('-', ''), image = `interview-studio-fixture:${id}`;
  const volume = `studio-fixture-${id}`;
  let container: string | undefined, built = false, createdVolume = false;
  t.after(async () => {
    try {
      if (container) {
        await docker('stop', '--time=15', container);
        await docker('rm', container);
      }
    } finally {
      try { if (createdVolume) await docker('volume', 'rm', volume); }
      finally { if (built) await docker('image', 'rm', image); }
    }
  });
  await docker('build', '--quiet', '--tag', image, '.');
  built = true;
  await docker('volume', 'create', volume);
  createdVolume = true;
  container = (await docker('run', '-d', '--name', `studio-fixture-${id}`, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--tmpfs', '/tmp', '--mount', `type=volume,source=${volume},target=/app/data`, '-p', '127.0.0.1::3000', image)).stdout.trim();
  assert.match(container, /^[a-f0-9]{64}$/);
  const bound = (await docker('port', container, '3000')).stdout.trim();
  assert.match(bound, /^127\.0\.0\.1:\d+$/);
  let url = `http://${bound}`;
  async function ready() {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${url}/api/ready`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          assert.deepEqual(await response.json(), { status: 'ready', mode: 'local' });
          return;
        }
      } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof Error && error.name === 'TimeoutError')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const logs = await docker('logs', container!);
    throw new Error(`The fixture container failed readiness: ${logs.stdout} ${logs.stderr}`);
  }
  await ready();
  const inspection = await docker('exec', container, 'node', '-e', `const fs=require('node:fs'); console.log(JSON.stringify({uid:process.getuid(),missing:['vite','tsx','typescript','esbuild'].every(p=>!fs.existsSync('/app/node_modules/'+p)),privateFilesAbsent:['.env','.cred','server','src'].every(p=>!fs.existsSync('/app/'+p)),cli:fs.existsSync('/app/dist-server/db/cli.js')}))`);
  assert.deepEqual(JSON.parse(inspection.stdout), { uid: 1000, missing: true, privateFilesAbsent: true, cli: true });
  const login = await fetch(`${url}/api/auth/demo`, { method: 'POST' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const target = await fetch(`${url}/api/targets`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ company: 'Meta', level: 'Senior', role: 'Engineer', date: '' }) });
  assert.equal(target.status, 200);
  const before = await (await fetch(`${url}/api/bootstrap`, { headers: { Cookie: cookie } })).json() as Bootstrap;
  assert.equal(before.state.targets.length, 1);
  await docker('restart', '--time=15', container);
  url = `http://${(await docker('port', container, '3000')).stdout.trim()}`;
  await ready();
  const after = await (await fetch(`${url}/api/bootstrap`, { headers: { Cookie: cookie } })).json() as Bootstrap;
  assert.deepEqual(after, before);
  await docker('stop', '--time=15', container);
  const state = JSON.parse((await docker('inspect', '--format', '{{json .State}}', container)).stdout) as { Running: boolean; ExitCode: number };
  assert.equal(state.Running, false);
  assert.equal(state.ExitCode, 0);
});


test('staging migration gate and encrypted PostgreSQL backup restore preserve owned state in an isolated recovery runtime', { timeout: 240000 }, async t => {
  const id = randomUUID().replaceAll('-', ''), project = `studio-recovery-${id}`, image = `interview-studio-fixture:${id}`;
  const password = randomBytes(24).toString('hex');
  const args = ['compose', '--env-file', '/dev/null', '-f', 'compose.staging.yml', '-p', project];
  const env = { ...process.env, POSTGRES_PASSWORD: password, DATABASE_URL: `postgresql://studio:${password}@database:5432/studio`, STUDIO_IMAGE: image, STUDIO_PORT: '0' };
  const compose = (...commands: string[]) => execute('docker', [...args, ...commands], { env, encoding: 'buffer', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  let built = false, staged = false, recovery: string | undefined;
  t.after(async () => {
    try {
      if (recovery) {
        await docker('stop', '--time=15', recovery);
        await docker('rm', recovery);
      }
    } finally {
      try { if (staged) await compose('down', '--volumes', '--remove-orphans'); }
      finally { if (built) await docker('image', 'rm', image); }
    }
  });
  await docker('build', '--quiet', '--tag', image, '.');
  built = true;
  staged = true;
  await compose('up', '-d', '--no-build', '--quiet-pull', '--wait', '--wait-timeout', '60');
  const url = `http://${(await compose('port', 'api', '3000')).stdout.toString().trim()}`;
  const ready = await fetch(`${url}/api/ready`);
  assert.equal(ready.status, 200);
  const login = await fetch(`${url}/api/auth/demo`, { method: 'POST' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const saved = await fetch(`${url}/api/targets`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ company: 'Meta', level: 'Senior', role: 'Recovered Engineer', date: '' }) });
  assert.equal(saved.status, 200);
  const before = await (await fetch(`${url}/api/bootstrap`, { headers: { Cookie: cookie } })).json() as Bootstrap;
  const backup = (await compose('exec', '-T', 'database', 'pg_dump', '-U', 'studio', '-d', 'studio', '-Fc')).stdout;
  assert.ok(backup.length > 1000);
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(backup), cipher.final()]), tag = cipher.getAuthTag();
  const tampered = Buffer.from(encrypted);
  tampered[0] ^= 1;
  assert.throws(() => {
    const invalid = createDecipheriv('aes-256-gcm', key, iv);
    invalid.setAuthTag(tag);
    invalid.update(tampered);
    invalid.final();
  });
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const restoredBytes = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  assert.deepEqual(restoredBytes, backup);
  await compose('exec', '-T', 'database', 'psql', '-U', 'studio', '-d', 'studio', '-c', 'CREATE DATABASE restore_fixture');
  await new Promise<void>((resolve, reject) => {
    const restore = spawn('docker', [...args, 'exec', '-T', 'database', 'pg_restore', '-U', 'studio', '-d', 'restore_fixture', '--exit-on-error'], { env, timeout: 60000, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    restore.stderr.on('data', chunk => { stderr += String(chunk); });
    restore.once('error', reject);
    restore.stdin.once('error', reject);
    restore.once('close', code => code === 0 ? resolve() : reject(new Error(`Fixture restore failed (${code}): ${stderr}`)));
    restore.stdin.end(restoredBytes);
  });
  recovery = (await docker('run', '-d', '--network', `${project}_default`, '--read-only', '--tmpfs', '/tmp', '-e', `DATABASE_URL=postgresql://studio:${password}@database:5432/restore_fixture`, '-p', '127.0.0.1::3000', image)).stdout.trim();
  const recoveryUrl = `http://${(await docker('port', recovery, '3000')).stdout.trim()}`;
  const deadline = Date.now() + 15000;
  let responsive = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${recoveryUrl}/api/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { responsive = true; break; }
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof Error && error.name === 'TimeoutError')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(responsive, 'The restored runtime must pass readiness against restored migration history.');
  const after = await (await fetch(`${recoveryUrl}/api/bootstrap`, { headers: { Cookie: cookie } })).json() as Bootstrap;
  assert.deepEqual(after, before);
});
