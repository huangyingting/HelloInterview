import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { GET as bootstrap } from '../app/api/bootstrap/route';
import { GET as health } from '../app/api/health/route';
import { GET as ready } from '../app/api/ready/route';
import { postgresConnection } from '../server/db/connection';
import { migrateDatabase } from '../server/db/migrations';
import { prismaConnection } from '../server/db/prisma';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('Next.js health, readiness, Prisma transactions and visitor bootstrap use the migrated schema', {
  skip: !databaseUrl && 'TEST_DATABASE_URL is required for the PostgreSQL Next.js runtime fixture.',
}, async t => {
  const root = postgresConnection(databaseUrl!);
  const schema = `next_test_${randomUUID().replaceAll('-', '')}`;
  await root.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const migration = postgresConnection(url.href);
  await migrateDatabase(migration);
  await migration.close();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.href;
  for (const key of ['NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET',
    'AUTH_FACEBOOK_CLIENT_ID', 'AUTH_FACEBOOK_CLIENT_SECRET', 'AUTH_INVITED_EMAILS']) delete process.env[key];
  t.after(async () => {
    await prismaConnection().close();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    try { await root.exec(`DROP SCHEMA ${schema} CASCADE`); } finally { await root.close(); }
  });
  const db = prismaConnection();
  await assert.rejects(db.transaction(async () => {
    await db.prepare("INSERT INTO users (id,name,email,password,demo) VALUES (?,'Rollback owner',NULL,NULL,0)").run(randomUUID());
    await db.transaction(async () => { throw new Error('rollback'); });
  }), /rollback/);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM users').get())?.count, 0);
  const healthPayload = await health().json();
  const readyResponse = await ready(), readyPayload = await readyResponse.json();
  const bootstrapResponse = await bootstrap(), bootstrapPayload = await bootstrapResponse.json();
  assert.deepEqual(healthPayload, { status: 'ok' });
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(readyPayload, { status: 'ready', mode: 'service' });
  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapPayload.user, null);
  assert.equal(bootstrapPayload.capabilities.auth.system, 'authjs');
  assert.equal(bootstrapPayload.capabilities.access.state, 'visitor');
});
