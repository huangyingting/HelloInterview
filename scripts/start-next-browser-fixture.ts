import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { postgresConnection } from '../server/db/connection';
import { migrateDatabase } from '../server/db/migrations';
import { prismaConnection } from '../server/db/prisma';
import { bootstrapAdminAccount } from './bootstrap-admin';
import { createAccountInvitation } from '../server/account-admission/invitations';
import { registerInInvitationMode } from '../server/account-admission/registration';
import { browserAccount, browserOrigin, browserPort } from '../tests/browser-account';
import { migrateJobs } from '../server/jobs';

const rootUrl = process.env.TEST_DATABASE_URL;
if (!rootUrl) throw new Error('TEST_DATABASE_URL is required for the Next.js browser fixture.');

const root = postgresConnection(rootUrl);
const schema = `browser_test_${randomUUID().replaceAll('-', '')}`;
const database = new URL(rootUrl);
database.searchParams.set('options', `-c search_path=${schema}`);
const fixtureEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  HOSTNAME: '127.0.0.1',
  PORT: String(browserPort),
  DATABASE_URL: database.href,
  NEXTAUTH_URL: browserOrigin,
  NEXTAUTH_SECRET: 'browser-auth-secret-browser-auth-secret-browser-auth-secret',
  AUTH_GOOGLE_CLIENT_ID: '',
  AUTH_GOOGLE_CLIENT_SECRET: '',
  AUTH_FACEBOOK_CLIENT_ID: '',
  AUTH_FACEBOOK_CLIENT_SECRET: '',
  AUTH_INVITED_EMAILS: '',
  AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64url'),
  ACCOUNT_ADMISSION_MODE: 'invitation-only',
  ACCOUNT_MAIL_WORKFLOW_ENABLED: 'false',
  COMMUNITY_WRITES_ENABLED: 'false',
  PRIVACY_CONTROLLER_NAME: 'Isolated browser fixture',
  PRIVACY_CONTACT_URL: 'https://example.test/privacy',
  PARTICIPANT_MINIMUM_AGE: '18',
  PRIVACY_RETENTION_NOTICE: 'Synthetic records exist only for the duration of the isolated browser fixture.',
  PRIVACY_DELETION_NOTICE: 'The isolated schema is removed when the test server shuts down.',
  PRIVATE_BETA_NO_DURABILITY_ACK: 'true',
};
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
    await migrateJobs(migration);
  } finally {
    await migration.close();
  }
  Object.assign(process.env, fixtureEnvironment);
  try {
    const admin = await bootstrapAdminAccount({ email: 'browser-admin@example.test', name: 'Fixture Administrator', password: browserAccount.password });
    const invitation = await createAccountInvitation({ email: browserAccount.email, invitedById: admin.userId });
    if (!invitation.ok) throw new Error('The isolated browser invitation could not be created.');
    const member = await registerInInvitationMode({ token: invitation.token, ...browserAccount });
    if (!member.ok) throw new Error('The isolated browser member could not be admitted.');
  } finally {
    await prismaConnection().close();
  }

  child = spawn(process.execPath, ['.next/standalone/server.js'], {
    env: fixtureEnvironment,
    stdio: 'inherit',
  });
  [code] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
} finally {
  try {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await root.exec(`DROP SCHEMA IF EXISTS ${schema}_jobs CASCADE`);
    await root.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await root.close();
  }
}
process.exitCode = shutdownSignal ? 0 : code ?? 1;
