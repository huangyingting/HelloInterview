import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { postgresConnection } from '../server/db/connection';
import { migrateDatabase } from '../server/db/migrations';

const rootUrl = process.env.TEST_DATABASE_URL;
if (!rootUrl) throw new Error('TEST_DATABASE_URL is required for the Next.js browser fixture.');

const root = postgresConnection(rootUrl);
const schema = `browser_test_${randomUUID().replaceAll('-', '')}`;
const database = new URL(rootUrl);
database.searchParams.set('options', `-c search_path=${schema}`);
let child: ReturnType<typeof spawn> | undefined;
let shutdownSignal: NodeJS.Signals | null = null;
function stop(signal: NodeJS.Signals) {
  if (shutdownSignal) return;
  shutdownSignal = signal;
  if (child?.exitCode === null && child.signalCode === null) child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

let code: number | null = null;
try {
  await root.exec(`CREATE SCHEMA ${schema}`);
  const migration = postgresConnection(database.href);
  try {
    await migrateDatabase(migration);
  } finally {
    await migration.close();
  }

  child = spawn(process.execPath, [
    'node_modules/next/dist/bin/next',
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3100',
  ], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: database.href,
      NEXTAUTH_URL: 'http://127.0.0.1:3100',
      NEXTAUTH_SECRET: 'browser-auth-secret-browser-auth-secret-browser-auth-secret',
      AUTH_GOOGLE_CLIENT_ID: 'browser-google-client',
      AUTH_GOOGLE_CLIENT_SECRET: 'browser-google-secret',
      AUTH_FACEBOOK_CLIENT_ID: '123456789',
      AUTH_FACEBOOK_CLIENT_SECRET: 'browser-facebook-secret',
      AUTH_INVITED_EMAILS: 'browser-owner@example.test',
      AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64url'),
    },
    stdio: 'inherit',
  });
  [code] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
} finally {
  try {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await root.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await root.close();
  }
}
process.exitCode = shutdownSignal ? 0 : code ?? 1;
