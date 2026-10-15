import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createDecipheriv, createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import test from 'node:test';
import type { Bootstrap } from '../shared/types';

const execute = promisify(execFile);
async function docker(...args: string[]) {
  return execute('docker', args, { timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
}

test('Next standalone release is hardened and preserves Auth.js-owned state through restart and restore', {
  timeout: 360000,
}, async t => {
  const id = randomUUID().replaceAll('-', '');
  const project = `studio-next-${id}`;
  const image = `interview-studio-next:${id}`;
  const password = randomBytes(24).toString('hex');
  const sessionToken = randomBytes(32).toString('hex');
  const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
  const owner = randomUUID(), identity = randomUUID(), sessionId = randomUUID();
  const auth = {
    NEXTAUTH_URL: 'http://localhost',
    NEXTAUTH_SECRET: 'container-auth-secret-container-auth-secret-container-auth-secret',
    AUTH_GOOGLE_CLIENT_ID: 'container-google-client',
    AUTH_GOOGLE_CLIENT_SECRET: 'container-google-secret',
    AUTH_FACEBOOK_CLIENT_ID: '123456789',
    AUTH_FACEBOOK_CLIENT_SECRET: 'container-facebook-secret',
    AUTH_INVITED_EMAILS: 'container-owner@example.test',
    AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64url'),
  };
  const service = {
    ...auth,
    PRIVACY_CONTROLLER_NAME: 'Container Studio Operator',
    PRIVACY_CONTACT_URL: 'https://interview.genisisiq.com/privacy',
    PARTICIPANT_MINIMUM_AGE: '18',
    PRIVACY_RETENTION_NOTICE: 'Container fixture records use a bounded private-beta retention policy.',
    PRIVACY_DELETION_NOTICE: 'Container fixture deletion requests use the reviewed private-beta workflow.',
    PRIVATE_BETA_NO_DURABILITY_ACK: 'true',
    TRUST_PROXY: '127.0.0.1/32',
  };
  const databaseUrl = `postgresql://studio:${password}@database:5432/studio`;
  const env = {
    ...process.env,
    POSTGRES_PASSWORD: password,
    DATABASE_URL: databaseUrl,
    STUDIO_IMAGE: image,
    STUDIO_PORT: '0',
    ...service,
  };
  const composeArgs = ['compose', '--env-file', '/dev/null', '-f', 'compose.staging.yml', '-p', project];
  const compose = (...commands: string[]) => execute('docker', [...composeArgs, ...commands], {
    env,
    encoding: 'buffer',
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024,
  });
  let built = false, staged = false, recovery: string | undefined;
  t.after(async () => {
    try {
      if (recovery) {
        await docker('stop', '--time=15', recovery);
        await docker('rm', recovery);
      }
    } finally {
      try {
        if (staged) await compose('down', '--volumes', '--remove-orphans');
      } finally {
        if (built) await docker('image', 'rm', image);
      }
    }
  });

  await docker('build', '--quiet', '--tag', image, '.');
  built = true;
  staged = true;
  await compose('up', '-d', '--no-build', '--quiet-pull', '--wait', '--wait-timeout', '90');
  const apiContainer = (await compose('ps', '-q', 'api')).stdout.toString().trim();
  let url = `http://${(await compose('port', 'api', '3000')).stdout.toString().trim()}`;

  async function ready(origin: string, container: string) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${origin}/api/ready?probe=${Date.now()}`, {
          headers: { Connection: 'close' },
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          assert.deepEqual(await response.json(), { status: 'ready', mode: 'service' });
          return;
        }
      } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof Error && error.name === 'TimeoutError')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const logs = await docker('logs', container);
    throw new Error(`The Next standalone fixture failed readiness: ${logs.stdout} ${logs.stderr}`);
  }

  await ready(url, apiContainer);
  const visitorResponse = await fetch(`${url}/api/bootstrap`);
  const visitor = await visitorResponse.json() as Bootstrap;
  assert.equal(visitorResponse.status, 200);
  assert.equal(visitor.user, null);
  assert.equal(visitor.capabilities.auth?.system, 'authjs');
  assert.equal(visitor.capabilities.participantPolicy?.minimumAge, 18);

  const inspection = await docker('exec', apiContainer, 'node', '-e', `
    const fs=require('node:fs');
    console.log(JSON.stringify({
      uid:process.getuid(),
      next:fs.existsSync('/app/server.js')&&fs.existsSync('/app/.next/server'),
      workers:fs.existsSync('/app/dist-server/db/cli.js')&&fs.existsSync('/app/dist-server/privacy/cli.js'),
      identityWorkerAbsent:!fs.existsSync('/app/dist-server/identity/cli.js'),
      developmentAbsent:['vite','tsx','typescript','esbuild'].every(value=>!fs.existsSync('/app/node_modules/'+value)),
      privateAbsent:['.env','data','src','server','dist','index.html','vite.config.ts'].every(value=>!fs.existsSync('/app/'+value))
    }));
  `);
  assert.deepEqual(JSON.parse(inspection.stdout), {
    uid: 1000,
    next: true,
    workers: true,
    identityWorkerAbsent: true,
    developmentAbsent: true,
    privateAbsent: true,
  });
  const preflight = await docker('exec', apiContainer, 'node', 'dist-server/preflight/cli.js');
  const preflightResult = JSON.parse(preflight.stdout);
  assert.deepEqual(preflightResult.identity, {
    system: 'authjs',
    providers: ['facebook', 'google'],
    inviteCount: 1,
  });
  assert.deepEqual(preflightResult.participantPolicy, {
    minimumAge: 18,
    contactProtocol: 'https:',
    noDurability: true,
  });
  assert.deepEqual(preflightResult.features, { ai: false, billing: false, community: 'read-only' });
  assert.equal(preflightResult.mode, 'service');
  assert.equal(preflightResult.listener.loopback, false);
  assert.equal(preflightResult.trustedProxyCount, 1);
  assert.ok(preflightResult.database.migrationCount > 0);
  assert.ok(preflightResult.database.maintainedQueueCount > 0);
  for (const privateValue of [password, auth.NEXTAUTH_SECRET, auth.AUTH_GOOGLE_CLIENT_SECRET,
    service.PRIVACY_CONTROLLER_NAME, service.PRIVACY_RETENTION_NOTICE]) {
    assert.equal(preflight.stdout.includes(privateValue), false);
  }

  const now = Date.now();
  const sql = `
    INSERT INTO users(id,name,email,password,demo) VALUES('${owner}','Container owner','container-owner@example.test',NULL,0);
    INSERT INTO user_settings(user_id) VALUES('${owner}');
    INSERT INTO managed_identities(id,user_id,issuer,subject,provider,email,verified,available)
      VALUES('${identity}','${owner}','https://accounts.google.com','container-subject','google','container-owner@example.test',1,1);
    INSERT INTO managed_accounts(user_id,status,contact_email,contact_identity_id,contact_verified)
      VALUES('${owner}','active','container-owner@example.test','${identity}',1);
    INSERT INTO sessions(token,user_id,expires) VALUES('${sessionHash}','${owner}',${now + 30 * 86400000});
    INSERT INTO managed_sessions(token,id,identity_id,epoch,csrf_hash,authenticated_at,created_at,last_used,mfa_at)
      VALUES('${sessionHash}','${sessionId}','${identity}',0,'${'0'.repeat(64)}',${now},${now},${now},0);
  `;
  await compose('exec', '-T', 'database', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'studio', '-d', 'studio', '-c', sql);

  const authenticatedResponse = await fetch(`${url}/api/bootstrap`, {
    headers: { Cookie: `studio_session=${sessionToken}` },
  });
  const authenticated = await authenticatedResponse.json() as Bootstrap;
  const csrfCookie = authenticatedResponse.headers.get('set-cookie')?.split(';')[0];
  assert.equal(authenticated.user?.id, owner);
  assert.match(csrfCookie ?? '', /^studio_csrf=[a-f0-9]{64}$/);
  const csrf = csrfCookie!.slice('studio_csrf='.length);
  const cookies = `studio_session=${sessionToken}; ${csrfCookie}`;
  const targetResponse = await fetch(`${url}/api/targets`, {
    method: 'POST',
    headers: { Cookie: cookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ company: 'Meta', level: 'Senior', role: 'Container Engineer', date: '' }),
  });
  assert.equal(targetResponse.status, 200);
  const before = await (await fetch(`${url}/api/bootstrap`, { headers: { Cookie: cookies } })).json() as Bootstrap;
  assert.equal(before.state.targets.length, 1);
  const stable = (value: Bootstrap) => ({
    ...value,
    capabilities: {
      ...value.capabilities,
      access: value.capabilities.access ? { ...value.capabilities.access, serverTime: '<database-clock>' } : undefined,
    },
  });

  await docker('restart', '--time=15', apiContainer);
  url = `http://${(await compose('port', 'api', '3000')).stdout.toString().trim()}`;
  await ready(url, apiContainer);
  const restarted = await (await fetch(`${url}/api/bootstrap`, { headers: { Cookie: cookies } })).json() as Bootstrap;
  assert.deepEqual(stable(restarted), stable(before));

  const backup = (await compose('exec', '-T', 'database', 'pg_dump', '-U', 'studio', '-d', 'studio', '-Fc')).stdout;
  assert.ok(backup.length > 1000);
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(backup), cipher.final()]);
  const tag = cipher.getAuthTag();
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
  const restored = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  assert.deepEqual(restored, backup);

  await compose('exec', '-T', 'database', 'psql', '-U', 'studio', '-d', 'studio', '-c', 'CREATE DATABASE restore_fixture');
  await new Promise<void>((resolve, reject) => {
    const restore = spawn('docker', [...composeArgs, 'exec', '-T', 'database', 'pg_restore', '-U', 'studio',
      '-d', 'restore_fixture', '--exit-on-error'], {
      env,
      timeout: 90000,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    restore.stderr.on('data', value => { stderr += String(value); });
    restore.once('error', reject);
    restore.stdin.once('error', reject);
    restore.once('close', code => code === 0 ? resolve() : reject(new Error(`Fixture restore failed (${code}): ${stderr}`)));
    restore.stdin.end(restored);
  });

  const runArgs = ['run', '-d', '--network', `${project}_default`, '--read-only', '--tmpfs', '/tmp',
    '-e', `DATABASE_URL=postgresql://studio:${password}@database:5432/restore_fixture`,
    ...Object.entries(service).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    '-e', 'HOSTNAME=0.0.0.0', '-e', 'PORT=3000',
    '-p', '127.0.0.1::3000', image];
  recovery = (await docker(...runArgs)).stdout.trim();
  const recoveryUrl = `http://${(await docker('port', recovery, '3000')).stdout.trim()}`;
  await ready(recoveryUrl, recovery);
  const recovered = await (await fetch(`${recoveryUrl}/api/bootstrap`, {
    headers: { Cookie: cookies },
  })).json() as Bootstrap;
  assert.deepEqual(stable(recovered), stable(before));
});
