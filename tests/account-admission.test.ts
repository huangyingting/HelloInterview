import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { GET as bootstrapRoute } from '../app/api/bootstrap/route';
import { POST as inspectInvitationRoute } from '../app/api/auth/invitation/route';
import { POST as registerRoute } from '../app/api/auth/register/route';
import { POST as verifyEmailRoute } from '../app/api/auth/verify-email/route';
import { POST as passwordLoginRoute } from '../app/api/auth/password/login/route';
import { POST as forgotPasswordRoute } from '../app/api/auth/password/forgot/route';
import { POST as resetPasswordRoute } from '../app/api/auth/password/reset/route';
import {
  GET as getAuthMethodsRoute,
  PUT as putAuthMethodsRoute,
} from '../app/api/account/auth-methods/route';
import { POST as accountMailTickRoute } from '../app/api/account-mail/tick/route';
import {
  GET as listInvitationsRoute,
  POST as createInvitationRoute,
} from '../app/api/admin/invitations/route';
import { DELETE as revokeInvitationRoute } from '../app/api/admin/invitations/[id]/route';
import { POST as rotateInvitationRoute } from '../app/api/admin/invitations/[id]/rotate/route';
import { bootstrapAdminAccount } from '../scripts/bootstrap-admin';
import {
  buildEmailVerificationUrl,
  buildInvitationAcceptUrl,
  buildPasswordResetUrl,
  generateOpaqueToken,
  getAccountAdmissionMode,
  hashOpaqueToken,
  hashPassword,
  isValidEmail,
  maskEmail,
  normalizeEmail,
  validatePasswordPolicy,
  verifyPassword,
  verifyPasswordOrDummy,
} from '../server/account-admission';
import { admitSocialIdentity, assertSocialAdmission, type SocialProof } from '../server/auth/admission';
import { loadAuthSettings } from '../server/auth/config';
import { postgresConnection } from '../server/db/connection';
import { migrateDatabase } from '../server/db/migrations';
import { prismaConnection } from '../server/db/prisma';

function extractCookies(response: Response): Map<string, string> {
  const map = new Map<string, string>();
  const headers = response.headers.getSetCookie?.() ?? [];
  for (const header of headers) {
    const pair = header.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) {
      map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  return map;
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function extractTokenFromPath(url: string, prefix: string): string {
  const parsed = new URL(url);
  assert.ok(parsed.pathname.startsWith(prefix), `Expected ${parsed.pathname} to start with ${prefix}`);
  return decodeURIComponent(parsed.pathname.slice(prefix.length));
}

test('account admission policy, password hashing, token hashing, and URL builders', async () => {
  const prevMode = process.env.ACCOUNT_ADMISSION_MODE;
  try {
    delete process.env.ACCOUNT_ADMISSION_MODE;
    assert.equal(getAccountAdmissionMode(), 'invitation-only');
    process.env.ACCOUNT_ADMISSION_MODE = 'unknown-value';
    assert.equal(getAccountAdmissionMode(), 'invitation-only');
    process.env.ACCOUNT_ADMISSION_MODE = 'public';
    assert.equal(getAccountAdmissionMode(), 'public');
  } finally {
    if (prevMode === undefined) delete process.env.ACCOUNT_ADMISSION_MODE;
    else process.env.ACCOUNT_ADMISSION_MODE = prevMode;
  }

  assert.equal(normalizeEmail('  Candidate.User@Example.COM '), 'candidate.user@example.com');
  assert.equal(isValidEmail('candidate@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(maskEmail('candidate@example.com'), 'ca***@example.com');

  assert.equal(validatePasswordPolicy('short').ok, false);
  assert.equal(validatePasswordPolicy('StrongPassphrase!123').ok, true);

  const hash = await hashPassword('StrongPassphrase!123');
  assert.equal(await verifyPassword('StrongPassphrase!123', hash), true);
  assert.equal(await verifyPassword('WrongPassphrase!123', hash), false);
  assert.equal(await verifyPasswordOrDummy('WrongPassphrase!123', null), false);

  const token = generateOpaqueToken(32);
  const tokenHash = hashOpaqueToken(token);
  assert.equal(tokenHash.length, 43);
  assert.notEqual(tokenHash, token);

  assert.match(buildInvitationAcceptUrl('tok_123'), /\/invite\/tok_123$/);
  assert.match(buildEmailVerificationUrl('tok_456'), /\/verify-email\/tok_456$/);
  assert.match(buildPasswordResetUrl('tok_789'), /\/reset-password\/tok_789$/);
});

const databaseUrl = process.env.TEST_DATABASE_URL;

test('invite-only account admission lifecycle: bootstrap admin, create/rotate/revoke invites, claim via password & Google OAuth, password reset & outbox worker', {
  skip: !databaseUrl && 'TEST_DATABASE_URL is required for PostgreSQL account-admission integration tests.',
}, async t => {
  const root = postgresConnection(databaseUrl!);
  const schema = `admission_test_${randomUUID().replaceAll('-', '')}`;
  await root.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const migration = postgresConnection(url.href);
  await migrateDatabase(migration);
  await migration.close();

  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    AUTH_GOOGLE_CLIENT_ID: process.env.AUTH_GOOGLE_CLIENT_ID,
    AUTH_GOOGLE_CLIENT_SECRET: process.env.AUTH_GOOGLE_CLIENT_SECRET,
    AUTH_FACEBOOK_CLIENT_ID: process.env.AUTH_FACEBOOK_CLIENT_ID,
    AUTH_FACEBOOK_CLIENT_SECRET: process.env.AUTH_FACEBOOK_CLIENT_SECRET,
    AUTH_INVITED_EMAILS: process.env.AUTH_INVITED_EMAILS,
    AUTH_MFA_ENCRYPTION_KEY: process.env.AUTH_MFA_ENCRYPTION_KEY,
    ACCOUNT_ADMISSION_MODE: process.env.ACCOUNT_ADMISSION_MODE,
    ACCOUNT_MAIL_WORKFLOW_ENABLED: process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED,
    ACCOUNT_MAIL_WORKER_SECRET: process.env.ACCOUNT_MAIL_WORKER_SECRET,
    ACCOUNT_EMAIL_WORKER_TOKEN: process.env.ACCOUNT_EMAIL_WORKER_TOKEN,
  };

  const workerSecret = 'worker-secret-token-fixture-32-chars-minimum';
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    NEXTAUTH_URL: 'https://interview.genisisiq.com',
    NEXTAUTH_SECRET: 'a'.repeat(64),
    AUTH_GOOGLE_CLIENT_ID: 'google-client',
    AUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    AUTH_FACEBOOK_CLIENT_ID: '123456789',
    AUTH_FACEBOOK_CLIENT_SECRET: 'facebook-secret',
    AUTH_INVITED_EMAILS: 'env-invited@example.test',
    AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
    ACCOUNT_ADMISSION_MODE: 'invitation-only',
    ACCOUNT_MAIL_WORKFLOW_ENABLED: 'true',
    ACCOUNT_MAIL_WORKER_SECRET: workerSecret,
    ACCOUNT_EMAIL_WORKER_TOKEN: workerSecret,
  });

  t.after(async () => {
    await prismaConnection().close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { await root.exec(`DROP SCHEMA ${schema} CASCADE`); } finally { await root.close(); }
  });

  const db = prismaConnection();

  // 1. Bootstrap an administrator account with a password credential
  const adminBoot = await bootstrapAdminAccount({
    email: 'admin@example.test',
    name: 'Studio Admin',
    password: 'AdminPassword!12345',
  });
  assert.equal(adminBoot.created, true);
  assert.equal(adminBoot.roleGranted, true);

  // 2. Sign in as administrator using POST /api/auth/password/login
  const adminLoginRes = await passwordLoginRoute(
    new Request('https://interview.genisisiq.com/api/auth/password/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.test',
        password: 'AdminPassword!12345',
      }),
    }),
  );
  assert.equal(adminLoginRes.status, 200);
  const adminCookies = extractCookies(adminLoginRes);
  assert.ok(adminCookies.get('__Host-studio_session'));
  assert.ok(adminCookies.get('__Host-studio_csrf'));

  // Verify bootstrap reflects authenticated admin session and admissionMode
  const adminBootstrapRes = await bootstrapRoute(
    new Request('https://interview.genisisiq.com/api/bootstrap', {
      headers: { Cookie: cookieHeader(adminCookies) },
    }),
  );
  assert.equal(adminBootstrapRes.status, 200);
  const adminBootstrap = await adminBootstrapRes.json();
  assert.equal(adminBootstrap.user.id, adminBoot.userId);
  assert.equal(adminBootstrap.capabilities.auth.admissionMode, 'invitation-only');
  assert.equal(adminBootstrap.capabilities.auth.emailDelivery, true);
  assert.ok(adminBootstrap.capabilities.staff.roles.includes('administrator'));

  // 3. Unauthenticated caller cannot list or create invitations
  const unauthInviteList = await listInvitationsRoute(
    new Request('https://interview.genisisiq.com/api/admin/invitations'),
  );
  assert.equal(unauthInviteList.status, 401);

  // 4. Uninvited user cannot self-register in invitation-only mode
  const uninvitedRegisterRes = await registerRoute(
    new Request('https://interview.genisisiq.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'stranger@example.test',
        password: 'StrangerPassword!123',
      }),
    }),
  );
  assert.equal(uninvitedRegisterRes.status, 403);
  assert.equal((await uninvitedRegisterRes.json()).error, 'invitation_required');

  // 5. Admin creates an invitation for candidate@example.test
  const createInviteRes = await createInvitationRoute(
    new Request('https://interview.genisisiq.com/api/admin/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(adminCookies),
        'X-CSRF-Token': adminCookies.get('__Host-studio_csrf')!,
      },
      body: JSON.stringify({
        email: 'Candidate@Example.test',
        expiresInDays: 7,
        sendEmail: true,
      }),
    }),
  );
  assert.equal(createInviteRes.status, 201);
  const createdInvite = await createInviteRes.json();
  assert.equal(createdInvite.invitation.normalizedEmail, 'candidate@example.test');
  assert.equal(createdInvite.invitation.status, 'PENDING');
  assert.equal(createdInvite.emailDelivery.queued, true);
  const firstToken = extractTokenFromPath(createdInvite.acceptUrl, '/invite/');

  // Ensure plaintext token is never stored in account_invitations
  const rawInviteRow = await db
    .prepare('SELECT token_hash, active_for_email FROM account_invitations WHERE id = ?')
    .get(createdInvite.invitation.id);
  assert.notEqual(rawInviteRow?.token_hash, firstToken);
  assert.equal(rawInviteRow?.token_hash, hashOpaqueToken(firstToken));
  assert.equal(rawInviteRow?.active_for_email, 'candidate@example.test');

  // Duplicate pending invitation for the same email is rejected with 409
  const duplicateInviteRes = await createInvitationRoute(
    new Request('https://interview.genisisiq.com/api/admin/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(adminCookies),
        'X-CSRF-Token': adminCookies.get('__Host-studio_csrf')!,
      },
      body: JSON.stringify({
        email: 'candidate@example.test',
        expiresInDays: 7,
      }),
    }),
  );
  assert.equal(duplicateInviteRes.status, 409);
  assert.equal((await duplicateInviteRes.json()).error, 'active_invitation_exists');

  // 6. Admin rotates the invitation link; old token is invalidated, new token is valid
  const rotateInviteRes = await rotateInvitationRoute(
    new Request(
      `https://interview.genisisiq.com/api/admin/invitations/${createdInvite.invitation.id}/rotate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader(adminCookies),
          'X-CSRF-Token': adminCookies.get('__Host-studio_csrf')!,
        },
        body: JSON.stringify({ expiresInDays: 14, sendEmail: false }),
      },
    ),
    { params: Promise.resolve({ id: createdInvite.invitation.id }) },
  );
  assert.equal(rotateInviteRes.status, 200);
  const rotatedInvite = await rotateInviteRes.json();
  const rotatedToken = extractTokenFromPath(rotatedInvite.acceptUrl, '/invite/');
  assert.notEqual(rotatedToken, firstToken);

  const inspectOldRes = await inspectInvitationRoute(
    new Request('https://interview.genisisiq.com/api/auth/invitation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: firstToken }),
    }),
  );
  assert.equal((await inspectOldRes.json()).invitation.status, 'invalid');

  const inspectNewRes = await inspectInvitationRoute(
    new Request('https://interview.genisisiq.com/api/auth/invitation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rotatedToken }),
    }),
  );
  const inspectNewPayload = await inspectNewRes.json();
  assert.equal(inspectNewPayload.invitation.status, 'pending');
  assert.equal(inspectNewPayload.invitation.maskedEmail, 'ca***@example.test');

  // 7. Claiming with wrong email fails closed without consuming the invitation
  const mismatchClaimRes = await registerRoute(
    new Request('https://interview.genisisiq.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: rotatedToken,
        email: 'wrong@example.test',
        password: 'CandidatePassword!123',
        name: 'Candidate User',
      }),
    }),
  );
  assert.equal(mismatchClaimRes.status, 403);
  assert.equal((await mismatchClaimRes.json()).error, 'email_mismatch');

  // 8. Candidate claims the invitation with matching email + password
  const claimRes = await registerRoute(
    new Request('https://interview.genisisiq.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: rotatedToken,
        email: 'candidate@example.test',
        password: 'CandidatePassword!123',
        name: 'Candidate User',
      }),
    }),
  );
  assert.equal(claimRes.status, 201);
  const claimPayload = await claimRes.json();
  assert.equal(claimPayload.authenticated, true);
  assert.equal(claimPayload.user.email, 'candidate@example.test');
  const candidateCookies = extractCookies(claimRes);
  assert.ok(candidateCookies.get('__Host-studio_session'));

  // Re-using the claimed token is rejected
  const replayClaimRes = await registerRoute(
    new Request('https://interview.genisisiq.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: rotatedToken,
        email: 'candidate@example.test',
        password: 'CandidatePassword!123',
      }),
    }),
  );
  assert.equal(replayClaimRes.status, 404);
  assert.equal((await replayClaimRes.json()).error, 'invalid_invitation');

  // Candidate cannot access admin invitations API
  const candidateAdminAttempt = await listInvitationsRoute(
    new Request('https://interview.genisisiq.com/api/admin/invitations', {
      headers: { Cookie: cookieHeader(candidateCookies) },
    }),
  );
  assert.equal(candidateAdminAttempt.status, 403);

  // 9. Candidate can inspect and update their password via /api/account/auth-methods
  const getMethodsRes = await getAuthMethodsRoute(
    new Request('https://interview.genisisiq.com/api/account/auth-methods', {
      headers: { Cookie: cookieHeader(candidateCookies) },
    }),
  );
  assert.equal(getMethodsRes.status, 200);
  assert.equal((await getMethodsRes.json()).hasPassword, true);

  const changePassRes = await putAuthMethodsRoute(
    new Request('https://interview.genisisiq.com/api/account/auth-methods', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(candidateCookies),
        'X-CSRF-Token': candidateCookies.get('__Host-studio_csrf')!,
      },
      body: JSON.stringify({
        currentPassword: 'CandidatePassword!123',
        newPassword: 'UpdatedCandidatePass!456',
      }),
    }),
  );
  assert.equal(changePassRes.status, 200);

  // 10. Password reset + encrypted outbox claim/ack workflow
  const forgotRes = await forgotPasswordRoute(
    new Request('https://interview.genisisiq.com/api/auth/password/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'candidate@example.test' }),
    }),
  );
  assert.equal(forgotRes.status, 202);

  // Drain outbox via /api/account-mail/tick until we find the password-reset email
  let resetUrl: string | null = null;
  for (let i = 0; i < 5; i += 1) {
    const claimMailRes = await accountMailTickRoute(
      new Request('https://interview.genisisiq.com/api/account-mail/tick', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ action: 'claim' }),
      }),
    );
    assert.equal(claimMailRes.status, 200);
    const { claimed } = (await claimMailRes.json()) as {
      claimed: { id: string; claimToken: string; kind: string; text: string } | null;
    };
    if (!claimed) break;
    if (claimed.kind === 'password-reset') {
      const match = claimed.text.match(/https:\/\/[^\s]+\/reset-password\/[^\s]+/);
      resetUrl = match ? match[0] : null;
    }
    const ackRes = await accountMailTickRoute(
      new Request('https://interview.genisisiq.com/api/account-mail/tick', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({
          action: 'ack',
          id: claimed.id,
          claimToken: claimed.claimToken,
          status: 'sent',
        }),
      }),
    );
    assert.equal(ackRes.status, 200);
  }
  assert.ok(resetUrl, 'Expected password-reset email in account_email_outbox');
  const resetToken = extractTokenFromPath(resetUrl!, '/reset-password/');

  const resetPassRes = await resetPasswordRoute(
    new Request('https://interview.genisisiq.com/api/auth/password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        password: 'ResetCandidatePassword!789',
      }),
    }),
  );
  assert.equal(resetPassRes.status, 200);

  // Candidate's previous session was revoked on password reset, and new password works
  const reloginRes = await passwordLoginRoute(
    new Request('https://interview.genisisiq.com/api/auth/password/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'candidate@example.test',
        password: 'ResetCandidatePassword!789',
      }),
    }),
  );
  assert.equal(reloginRes.status, 200);

  // 11. Admin creates and revokes an invitation, then re-invites the same email for Google OAuth admission
  const oauthInviteRes = await createInvitationRoute(
    new Request('https://interview.genisisiq.com/api/admin/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(adminCookies),
        'X-CSRF-Token': adminCookies.get('__Host-studio_csrf')!,
      },
      body: JSON.stringify({
        email: 'google-invitee@example.test',
        expiresInDays: 7,
        sendEmail: false,
      }),
    }),
  );
  assert.equal(oauthInviteRes.status, 201);
  const oauthInvite = await oauthInviteRes.json();

  const revokeRes = await revokeInvitationRoute(
    new Request(
      `https://interview.genisisiq.com/api/admin/invitations/${oauthInvite.invitation.id}`,
      {
        method: 'DELETE',
        headers: {
          Cookie: cookieHeader(adminCookies),
          'X-CSRF-Token': adminCookies.get('__Host-studio_csrf')!,
        },
      },
    ),
    { params: Promise.resolve({ id: oauthInvite.invitation.id }) },
  );
  assert.equal(revokeRes.status, 200);
  assert.equal((await revokeRes.json()).invitation.status, 'REVOKED');

  // Re-inviting after revocation succeeds because active_for_email was cleared on revoke
  const reinviteRes = await createInvitationRoute(
    new Request('https://interview.genisisiq.com/api/admin/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(adminCookies),
        'X-CSRF-Token': adminCookies.get('__Host-studio_csrf')!,
      },
      body: JSON.stringify({
        email: 'google-invitee@example.test',
        expiresInDays: 7,
        sendEmail: false,
      }),
    }),
  );
  assert.equal(reinviteRes.status, 201);
  const reinvite = await reinviteRes.json();

  // Google OAuth sign-in for google-invitee@example.test (not in AUTH_INVITED_EMAILS) succeeds via DB invitation
  const settings = loadAuthSettings()!;
  const googleProof: SocialProof = {
    provider: 'google',
    issuer: 'https://accounts.google.com',
    subject: 'google-invitee-sub-1',
    name: 'Google Invitee',
    email: 'google-invitee@example.test',
    verifiedEmail: true,
  };
  assert.throws(() => assertSocialAdmission(settings, googleProof, null), /invitation/);
  assert.doesNotThrow(() =>
    assertSocialAdmission(settings, googleProof, null, { hasDatabaseInvitation: true }),
  );
  const admittedOAuth = await admitSocialIdentity(
    settings,
    { provider: 'google', providerAccountId: 'google-invitee-sub-1', type: 'oauth' } as never,
    { name: 'Google Invitee', email: 'google-invitee@example.test', email_verified: true } as never,
  );
  assert.ok(admittedOAuth.userId);

  const acceptedRow = await db
    .prepare('SELECT status, accepted_by_id, active_for_email, token_hash FROM account_invitations WHERE id = ?')
    .get(reinvite.invitation.id);
  assert.equal(acceptedRow?.status, 'ACCEPTED');
  assert.equal(acceptedRow?.accepted_by_id, admittedOAuth.userId);
  assert.equal(acceptedRow?.active_for_email, null);
  assert.equal(acceptedRow?.token_hash, null);

  // 12. Public registration mode + email verification flow
  process.env.ACCOUNT_ADMISSION_MODE = 'public';
  const publicRegRes = await registerRoute(
    new Request('https://interview.genisisiq.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'public-user@example.test',
        password: 'PublicUserPassword!123',
        name: 'Public User',
      }),
    }),
  );
  assert.equal(publicRegRes.status, 202);

  let verifyUrl: string | null = null;
  for (let i = 0; i < 5; i += 1) {
    const claimMailRes = await accountMailTickRoute(
      new Request('https://interview.genisisiq.com/api/account-mail/tick', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ action: 'claim' }),
      }),
    );
    const { claimed } = (await claimMailRes.json()) as {
      claimed: { id: string; claimToken: string; kind: string; text: string } | null;
    };
    if (!claimed) break;
    if (claimed.kind === 'email-verification') {
      const match = claimed.text.match(/https:\/\/[^\s]+\/verify-email\/[^\s]+/);
      verifyUrl = match ? match[0] : null;
    }
    await accountMailTickRoute(
      new Request('https://interview.genisisiq.com/api/account-mail/tick', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({
          action: 'ack',
          id: claimed.id,
          claimToken: claimed.claimToken,
          status: 'sent',
        }),
      }),
    );
  }
  assert.ok(verifyUrl, 'Expected email-verification message in account_email_outbox');
  const verifyToken = extractTokenFromPath(verifyUrl!, '/verify-email/');

  const verifyRes = await verifyEmailRoute(
    new Request('https://interview.genisisiq.com/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    }),
  );
  assert.equal(verifyRes.status, 200);
  const verifyCookies = extractCookies(verifyRes);
  assert.ok(verifyCookies.get('__Host-studio_session'));
});
