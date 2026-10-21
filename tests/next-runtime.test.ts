import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import Stripe from 'stripe';
import { GET as bootstrap } from '../app/api/bootstrap/route';
import { GET as health } from '../app/api/health/route';
import { GET as ready } from '../app/api/ready/route';
import { GET as lesson } from '../app/api/content/lessons/[track]/[id]/route';
import { GET as problem } from '../app/api/content/problems/[id]/route';
import { GET as media } from '../app/api/content/media/[course]/[file]/route';
import { GET as community } from '../app/api/community/posts/route';
import { GET as communityPost } from '../app/api/community/posts/[id]/route';
import { GET as communityReportsRoute, POST as saveCommunityReportRoute } from '../app/api/community/reports/route';
import { GET as communityAppealsRoute, POST as saveCommunityAppealRoute } from '../app/api/community/appeals/route';
import { GET as communityMutesRoute, PUT as setCommunityMuteRoute } from '../app/api/community/mutes/route';
import { GET as communityBlocksRoute, PUT as setCommunityBlockRoute } from '../app/api/community/blocks/route';
import { GET as communityRestrictionsRoute } from '../app/api/community/restrictions/route';
import {
  GET as communityRestrictionAppealsRoute,
  POST as saveCommunityRestrictionAppealRoute,
} from '../app/api/community/restriction-appeals/route';
import { GET as comments } from '../app/api/comments/page/route';
import { POST as createCommentRoute } from '../app/api/comments/route';
import {
  DELETE as deleteOwnedCommentRoute,
  GET as ownedCommentRoute,
  PUT as updateOwnedCommentRoute,
} from '../app/api/comments/owned/route';
import {
  GET as commentSubmissionHistoryRoute,
  POST as createCommentSubmissionRoute,
} from '../app/api/comments/submissions/route';
import { GET as commentSubmissionReceiptRoute } from '../app/api/comments/submissions/receipt/route';
import { GET as posts, POST as createPostRoute } from '../app/api/posts/route';
import { POST as postActionRoute } from '../app/api/posts/actions/route';
import {
  DELETE as deleteOwnedPostRoute,
  GET as ownedPostRoute,
  PUT as updateOwnedPostRoute,
} from '../app/api/posts/owned/route';
import { GET as identitySecurityRoute } from '../app/api/identity/security/route';
import { DELETE as revokeSessionRoute } from '../app/api/identity/sessions/[id]/route';
import { DELETE as removeIdentityRoute } from '../app/api/identity/methods/[id]/route';
import { POST as beginIdentityLinkRoute } from '../app/api/identity/link/route';
import { DELETE as disableMfaRoute } from '../app/api/identity/mfa/route';
import { POST as beginMfaEnrollmentRoute } from '../app/api/identity/mfa/enrollment/route';
import { POST as verifyMfaEnrollmentRoute } from '../app/api/identity/mfa/enrollment/verify/route';
import { POST as completeMfaChallengeRoute } from '../app/api/identity/mfa/challenge/route';
import { POST as regenerateMfaRecoveryCodesRoute } from '../app/api/identity/mfa/recovery-codes/route';
import { PATCH as profileRoute } from '../app/api/profile/route';
import { GET as privacyExportsRoute, POST as requestPrivacyExportRoute } from '../app/api/privacy/exports/route';
import { GET as downloadPrivacyExportRoute } from '../app/api/privacy/exports/[id]/download/route';
import { GET as privacyDeletionRoute, POST as requestPrivacyDeletionRoute } from '../app/api/privacy/deletion/route';
import { POST as cancelPrivacyDeletionRoute } from '../app/api/privacy/deletion/cancel/route';
import { GET as billingViewRoute } from '../app/api/billing/route';
import { POST as reserveCheckoutRoute } from '../app/api/billing/checkouts/route';
import { POST as openCheckoutRoute } from '../app/api/billing/checkouts/[id]/open/route';
import { POST as billingPortalRoute } from '../app/api/billing/portal/route';
import { POST as stripeWebhookRoute } from '../app/api/webhooks/stripe/route';
import { POST as saveSupportRoute } from '../app/api/support/route';
import { GET as supportHistoryRoute } from '../app/api/support/requests/route';
import { POST as updateProgressRoute } from '../app/api/progress/route';
import { POST as enrollCourseRoute } from '../app/api/courses/[id]/enroll/route';
import { POST as saveCourseVideoRoute } from '../app/api/courses/[id]/video/route';
import { GET as listQuizSessionsRoute, POST as createQuizSessionRoute } from '../app/api/quiz-sessions/route';
import { GET as quizSessionRoute } from '../app/api/quiz-sessions/[id]/route';
import { POST as answerQuizSessionRoute } from '../app/api/quiz-sessions/[id]/answer/route';
import { POST as finishQuizSessionRoute } from '../app/api/quiz-sessions/[id]/finish/route';
import { GET as quizReportRoute } from '../app/api/quiz-reports/[id]/route';
import { POST as createTargetRoute } from '../app/api/targets/route';
import { DELETE as deleteTargetRoute } from '../app/api/targets/[id]/route';
import { POST as saveStoryRoute } from '../app/api/stories/route';
import { DELETE as deleteStoryRoute } from '../app/api/stories/[id]/route';
import { POST as saveAttemptRoute } from '../app/api/attempts/route';
import { POST as evaluateAttemptRoute } from '../app/api/attempts/[id]/evaluate/route';
import { DELETE as cancelAiOperationRoute, GET as aiOperationRoute } from '../app/api/ai/operations/[id]/route';
import { POST as createMockRoute } from '../app/api/mocks/route';
import { POST as saveMockDraftRoute } from '../app/api/mocks/[id]/draft/route';
import { POST as respondToMockRoute } from '../app/api/mocks/[id]/respond/route';
import { POST as createCustomQuizRoute } from '../app/api/custom-quizzes/route';
import { GET as customQuizQuestionRoute } from '../app/api/custom-quizzes/[id]/question/route';
import { POST as answerCustomQuizRoute } from '../app/api/custom-quizzes/[id]/answer/route';
import { POST as finishCustomQuizRoute } from '../app/api/custom-quizzes/[id]/finish/route';
import { POST as createStudyPlanRoute } from '../app/api/study-plans/route';
import { POST as savePlanReflectionRoute } from '../app/api/study-plans/[id]/reflection/route';
import { POST as createProjectRoute } from '../app/api/projects/route';
import { POST as saveProjectRoute } from '../app/api/projects/[id]/save/route';
import { POST as reviewProjectRoute } from '../app/api/projects/[id]/review/route';
import { DELETE as clearTutorRoute, POST as askTutorRoute } from '../app/api/tutor/route';
import { GET as staffSessionRoute } from '../app/api/staff/session/route';
import { GET as staffAccountsRoute } from '../app/api/staff/accounts/route';
import { GET as staffAuditRoute } from '../app/api/staff/audit/route';
import { GET as staffSupportRoute } from '../app/api/staff/support/route';
import { GET as staffReportsRoute } from '../app/api/staff/community/reports/route';
import { GET as staffAppealsRoute } from '../app/api/staff/community/appeals/route';
import { GET as staffRestrictionsRoute } from '../app/api/staff/community/restrictions/route';
import { GET as staffRestrictionAppealsRoute } from '../app/api/staff/community/restriction-appeals/route';
import { PATCH as changeStaffAccountStatusRoute } from '../app/api/staff/accounts/[id]/status/route';
import { PATCH as actOnStaffReportRoute } from '../app/api/staff/community/reports/[id]/route';
import { PATCH as reviewStaffTriageRoute } from '../app/api/staff/community/reports/[id]/triage/route';
import {
  POST as applyStaffRestrictionRoute,
} from '../app/api/staff/community/reports/[id]/restrictions/route';
import { PATCH as actOnStaffAppealRoute } from '../app/api/staff/community/appeals/[id]/route';
import { PATCH as changeStaffRestrictionRoute } from '../app/api/staff/community/restrictions/[id]/route';
import {
  PATCH as actOnStaffRestrictionAppealRoute,
} from '../app/api/staff/community/restriction-appeals/[id]/route';
import { PATCH as updateStaffSupportRoute } from '../app/api/staff/support/[id]/route';
import { POST as replyToStaffSupportRoute } from '../app/api/staff/support/[id]/replies/route';
import { postgresConnection } from '../server/db/connection';
import { migrateDatabase } from '../server/db/migrations';
import { prismaConnection } from '../server/db/prisma';
import { refreshAdmittedSession, studioAuthAdapter } from '../server/auth/adapter';
import { admitSocialIdentity } from '../server/auth/admission';
import { loadAuthSettings } from '../server/auth/config';
import { completeSocialLink } from '../server/auth/linking';
import { recordAuthAdmission, withAuthRequest } from '../server/auth/request-context';
import { totpCode } from '../server/auth/totp';
import { stripeApiVersion } from '../server/billing/schema';
import { closeNextPrivacyService } from '../server/next/privacy';
import { closeNextBillingService } from '../server/next/billing';
import { closeNextAiService } from '../server/next/ai';
import { migrateJobs } from '../server/jobs';
import { Entitlements } from '../server/entitlements';

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
  await migrateJobs(migration);
  await migration.close();
  const previous = process.env.DATABASE_URL;
  const previousCommunity = process.env.COMMUNITY_WRITES_ENABLED;
  process.env.DATABASE_URL = url.href;
  for (const key of ['NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET',
    'AUTH_FACEBOOK_CLIENT_ID', 'AUTH_FACEBOOK_CLIENT_SECRET', 'AUTH_INVITED_EMAILS',
    'AUTH_MFA_ENCRYPTION_KEY', 'STRIPE_TEST_ACCOUNT_ID', 'STRIPE_TEST_SECRET_KEY',
    'STRIPE_TEST_WEBHOOK_SECRET', 'STRIPE_TEST_OFFERS', 'MANAGED_AI_ENABLED', 'MANAGED_AI_MODEL_REVISION',
    'MANAGED_AI_INPUT_PRICE_MICROS_PER_MILLION_TOKENS',
    'MANAGED_AI_OUTPUT_PRICE_MICROS_PER_MILLION_TOKENS', 'MANAGED_AI_DATA_USE_NOTICE',
    'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT',
    'AZURE_OPENAI_API_VERSION']) delete process.env[key];
  Object.assign(process.env, {
    NEXTAUTH_URL: 'https://studio.fixture',
    NEXTAUTH_SECRET: 'a'.repeat(64),
    AUTH_GOOGLE_CLIENT_ID: 'google-client',
    AUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    AUTH_FACEBOOK_CLIENT_ID: '123456789',
    AUTH_FACEBOOK_CLIENT_SECRET: 'facebook-secret',
    AUTH_INVITED_EMAILS: 'next-auth-owner@example.test',
    AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
    COMMUNITY_WRITES_ENABLED: 'true',
    STRIPE_TEST_ACCOUNT_ID: 'acct_NextRuntimeFixture',
    STRIPE_TEST_SECRET_KEY: 'rk_test_NextRuntimeFixtureOnly',
    STRIPE_TEST_WEBHOOK_SECRET: 'whsec_NextRuntimeFixtureOnly',
    STRIPE_TEST_OFFERS: JSON.stringify({
      pro_monthly: 'price_NextMonthlyFixture',
      pro_annual: 'price_NextAnnualFixture',
    }),
  });
  t.after(async () => {
    await closeNextAiService();
    await closeNextBillingService();
    await closeNextPrivacyService();
    await prismaConnection().close();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    if (previousCommunity === undefined) delete process.env.COMMUNITY_WRITES_ENABLED; else process.env.COMMUNITY_WRITES_ENABLED = previousCommunity;
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
  const bootstrapResponse = await bootstrap(new Request('https://studio.fixture/api/bootstrap'));
  const bootstrapPayload = await bootstrapResponse.json();
  assert.deepEqual(healthPayload, { status: 'ok' });
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(readyPayload, { status: 'ready', mode: 'service' });
  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapPayload.user, null);
  assert.equal(bootstrapPayload.capabilities.auth.system, 'authjs');
  assert.equal(bootstrapPayload.capabilities.community, 'managed');
  assert.equal(bootstrapPayload.capabilities.access.state, 'visitor');
  assert.deepEqual(bootstrapPayload.capabilities.billing, { mode: 'sandbox', checkout: true });
  const owner = 'next-public-owner';
  const postId = 'a/b?c#d%\\e';
  await db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,?,0)')
    .run(owner, 'Private fixture owner', 'next-public-owner@example.test', null);
  await db.prepare(`INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).run(postId, 'questions', 'Opaque Next community question',
      'A public-safe body loaded through the Next.js read surface.', 'Fixture Company', 'system-design', 'Senior',
      'Global', 'THIS PRIVATE AUTHOR MUST NOT LEAK', owner, '2026-11-01T00:00:00.000Z');
  await db.prepare(`INSERT INTO comments(id,resource,user_id,author,body,created_at,parent_id)
    VALUES(?,?,?,?,?,?,NULL)`).run('next-public-comment', `post/${postId}`, owner, 'Public commenter',
      'A public-safe nested discussion comment.', '2026-11-01T00:00:01.000Z');
  const lessonResponse = await lesson(new Request('http://studio.fixture/api/content/lessons/system-design/introduction'), {
    params: Promise.resolve({ track: 'system-design', id: 'introduction' }),
  });
  const problemResponse = await problem(new Request('http://studio.fixture/api/content/problems/short-links'), {
    params: Promise.resolve({ id: 'short-links' }),
  });
  const mediaResponse = await media(new Request('http://studio.fixture/api/content/media/system-design/system-design.vtt'), {
    params: Promise.resolve({ course: 'system-design', file: 'system-design.vtt' }),
  });
  const communityResponse = await community(new Request('http://studio.fixture/api/community/posts?limit=6'));
  const communityPostResponse = await communityPost(new Request('http://studio.fixture/api/community/posts/opaque?kind=questions'), {
    params: Promise.resolve({ id: postId }),
  });
  const commentsResponse = await comments(new Request(
    `http://studio.fixture/api/comments/page?resource=${encodeURIComponent(`post/${postId}`)}`,
  ));
  const postsResponse = await posts(new Request('http://studio.fixture/api/posts?kind=questions'));
  const duplicateQueryResponse = await community(new Request('http://studio.fixture/api/community/posts?limit=6&limit=7'));
  assert.equal(lessonResponse.status, 200);
  assert.equal((await lessonResponse.json()).id, 'introduction');
  assert.match(lessonResponse.headers.get('X-Content-Version') ?? '', /^[a-f0-9]{64}$/);
  assert.equal(problemResponse.status, 200);
  assert.equal((await problemResponse.json()).id, 'short-links');
  assert.equal(mediaResponse.status, 200);
  assert.equal(mediaResponse.headers.get('Content-Type'), 'text/vtt; charset=utf-8');
  assert.ok((await mediaResponse.arrayBuffer()).byteLength > 100);
  const communityPayload = await communityResponse.json();
  assert.equal(communityPayload.total, 1);
  assert.equal(communityPayload.posts[0].id, postId);
  assert.equal(communityPayload.posts[0].author, 'Anonymous');
  assert.ok(!JSON.stringify(communityPayload).includes(owner));
  const communityPostPayload = await communityPostResponse.json();
  assert.equal(communityPostResponse.status, 200);
  assert.equal(communityPostPayload.id, postId);
  assert.equal(communityPostPayload.author, 'Anonymous');
  assert.ok(!JSON.stringify(communityPostPayload).includes(owner));
  const commentsPayload = await commentsResponse.json();
  assert.equal(commentsResponse.status, 200);
  assert.equal(commentsPayload.comments[0].body, 'A public-safe nested discussion comment.');
  assert.equal(commentsPayload.comments[0].author, 'Public commenter');
  assert.ok(!JSON.stringify(commentsPayload).includes(owner));
  const postsPayload = await postsResponse.json();
  assert.equal(postsPayload.length, 1);
  assert.equal(postsPayload[0].id, postId);
  assert.equal(postsPayload[0].author, 'Anonymous');
  assert.equal(duplicateQueryResponse.status, 400);

  const authOwner = '11111111-1111-4111-8111-111111111111';
  const identity = '22222222-2222-4222-8222-222222222222';
  await db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,?,0)')
    .run(authOwner, 'Next Auth Owner', null, null);
  await db.prepare('INSERT INTO user_settings(user_id) VALUES(?)').run(authOwner);
  await db.prepare(`INSERT INTO managed_identities(id,user_id,issuer,subject,provider,email,verified,available)
    VALUES(?,?,?,?,?,?,1,1)`).run(identity, authOwner, 'https://accounts.google.com', 'next-auth-subject', 'google',
      'next-auth-owner@example.test');
  await db.prepare(`INSERT INTO managed_accounts(user_id,status,contact_email,contact_identity_id,contact_verified)
    VALUES(?,'active',?,?,1)`).run(authOwner, 'next-auth-owner@example.test', identity);
  const adapter = studioAuthAdapter();
  const sessionToken = 'b'.repeat(64);
  await assert.rejects(
    adapter.createSession!({ sessionToken, userId: authOwner, expires: new Date(Date.now() + 86400000) }),
    /exact admitted provider identity/,
  );
  const createdSession = await withAuthRequest(new Request('https://studio.fixture/api/auth/callback/google'), async () => {
    recordAuthAdmission({ userId: authOwner, identityId: identity });
    return adapter.createSession!({ sessionToken, userId: authOwner, expires: new Date(Date.now() + 86400000) });
  });
  assert.equal(createdSession.sessionToken, sessionToken);
  assert.ok(createdSession.expires.getTime() > Date.now() + 29 * 86400000);
  const storedToken = createHash('sha256').update(sessionToken).digest('hex');
  const storedSession = await db.prepare(`SELECT s.token,m.csrf_hash,m.mfa_at FROM sessions s
    JOIN managed_sessions m ON m.token=s.token WHERE s.user_id=?`).get(authOwner);
  assert.equal(storedSession?.token, storedToken);
  assert.match(String(storedSession?.csrf_hash), /^[a-f0-9]{64}$/);
  assert.equal(Number(storedSession?.mfa_at), 0);
  assert.equal(await adapter.getSessionAndUser!('malformed-cookie'), null);
  assert.equal((await adapter.getSessionAndUser!(sessionToken))?.user.id, authOwner);
  const authenticatedBootstrap = await bootstrap(new Request('https://studio.fixture/api/bootstrap', {
    headers: { Cookie: `__Host-studio_session=${sessionToken}` },
  }));
  assert.equal(authenticatedBootstrap.status, 200);
  assert.equal((await authenticatedBootstrap.clone().json()).user.id, authOwner);
  const csrfCookie = authenticatedBootstrap.headers.get('Set-Cookie')?.split(';')[0];
  assert.match(csrfCookie ?? '', /^__Host-studio_csrf=[a-f0-9]{64}$/);
  const csrf = csrfCookie!.split('=')[1];
  const accountCookies = `__Host-studio_session=${sessionToken}; ${csrfCookie}`;
  const securityResponse = await identitySecurityRoute(new Request('https://studio.fixture/api/identity/security', {
    headers: { Cookie: accountCookies },
  }));
  const security = await securityResponse.json();
  assert.equal(securityResponse.status, 200);
  assert.equal(security.identities[0].provider, 'google');
  assert.equal(security.sessions[0].current, true);
  assert.deepEqual(security.mfa, {
    enabled: false,
    enrollmentPending: false,
    sessionVerified: false,
    recoveryCodesRemaining: 0,
  });
  await db.prepare(`UPDATE managed_sessions
    SET authenticated_at=floor(extract(epoch from clock_timestamp())*1000)::bigint-600001
    WHERE token=?`).run(storedToken);
  const staleSecurity = await identitySecurityRoute(new Request('https://studio.fixture/api/identity/security', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await staleSecurity.json()).fresh, false);
  await withAuthRequest(new Request('https://studio.fixture/api/auth/callback/google', {
    headers: { Cookie: `__Host-studio_session=${sessionToken}` },
  }), () => refreshAdmittedSession({ userId: authOwner, identityId: identity }, '__Host-studio_session'));
  const refreshedSecurity = await identitySecurityRoute(new Request('https://studio.fixture/api/identity/security', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await refreshedSecurity.json()).fresh, true);
  const mfaEnrollmentResponse = await beginMfaEnrollmentRoute(new Request(
    'https://studio.fixture/api/identity/mfa/enrollment',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: '{}',
    },
  ));
  const mfaEnrollment = await mfaEnrollmentResponse.json();
  assert.equal(mfaEnrollmentResponse.status, 200);
  assert.match(mfaEnrollment.secret, /^[A-Z2-7]{32}$/);
  assert.match(mfaEnrollment.uri, /^otpauth:\/\/totp\//);
  const pendingCredential = await db.prepare(`
    SELECT secret_ciphertext,status,pending_expires FROM managed_totp_credentials WHERE user_id=?
  `).get(authOwner);
  assert.equal(pendingCredential?.status, 'pending');
  assert.equal(String(pendingCredential?.secret_ciphertext).includes(mfaEnrollment.secret), false);
  assert.ok(Number(pendingCredential?.pending_expires) > Date.now());
  const enrollmentCode = totpCode(mfaEnrollment.secret);
  const wrongEnrollment = await verifyMfaEnrollmentRoute(new Request(
    'https://studio.fixture/api/identity/mfa/enrollment/verify',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ code: enrollmentCode === '000000' ? '000001' : '000000' }),
    },
  ));
  assert.equal(wrongEnrollment.status, 403);
  const verifiedEnrollment = await verifyMfaEnrollmentRoute(new Request(
    'https://studio.fixture/api/identity/mfa/enrollment/verify',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ code: enrollmentCode }),
    },
  ));
  const firstRecovery = await verifiedEnrollment.json();
  assert.equal(verifiedEnrollment.status, 200);
  assert.equal(firstRecovery.recoveryCodes.length, 10);
  assert.equal(new Set(firstRecovery.recoveryCodes).size, 10);
  assert.ok(firstRecovery.recoveryCodes.every((value: string) => /^[A-Z2-7]{5}(?:-[A-Z2-7]{5}){3}$/.test(value)));
  const activeSecurity = await identitySecurityRoute(new Request('https://studio.fixture/api/identity/security', {
    headers: { Cookie: accountCookies },
  }));
  assert.deepEqual((await activeSecurity.json()).mfa, {
    enabled: true,
    enrollmentPending: false,
    sessionVerified: true,
    recoveryCodesRemaining: 10,
  });
  const storedMfa = JSON.stringify(await db.prepare(`
    SELECT credential.secret_ciphertext,codes.code_hash
    FROM managed_totp_credentials credential
    JOIN managed_mfa_recovery_codes codes ON codes.user_id=credential.user_id
    WHERE credential.user_id=?
  `).all(authOwner));
  assert.equal(storedMfa.includes(mfaEnrollment.secret), false);
  assert.equal(firstRecovery.recoveryCodes.some((value: string) => storedMfa.includes(value)), false);
  const replayedTotp = await completeMfaChallengeRoute(new Request(
    'https://studio.fixture/api/identity/mfa/challenge',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ code: enrollmentCode }),
    },
  ));
  assert.equal(replayedTotp.status, 403);
  await db.prepare('UPDATE managed_sessions SET mfa_at=0 WHERE token=?').run(storedToken);
  const recoveryChallenge = await completeMfaChallengeRoute(new Request(
    'https://studio.fixture/api/identity/mfa/challenge',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ recoveryCode: firstRecovery.recoveryCodes[0] }),
    },
  ));
  assert.equal(recoveryChallenge.status, 200);
  assert.equal((await recoveryChallenge.json()).recovery, true);
  const replayedRecovery = await completeMfaChallengeRoute(new Request(
    'https://studio.fixture/api/identity/mfa/challenge',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ recoveryCode: firstRecovery.recoveryCodes[0] }),
    },
  ));
  assert.equal(replayedRecovery.status, 403);
  const regenerated = await regenerateMfaRecoveryCodesRoute(new Request(
    'https://studio.fixture/api/identity/mfa/recovery-codes',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: '{}',
    },
  ));
  const replacementRecovery = await regenerated.json();
  assert.equal(regenerated.status, 200);
  assert.equal(replacementRecovery.recoveryCodes.length, 10);
  assert.equal(replacementRecovery.recoveryCodes.includes(firstRecovery.recoveryCodes[1]), false);
  const disabled = await disableMfaRoute(new Request('https://studio.fixture/api/identity/mfa', {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'X-CSRF-Token': csrf },
  }));
  assert.equal(disabled.status, 200);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM managed_totp_credentials').get())?.count, 0);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM managed_mfa_recovery_codes').get())?.count, 0);
  assert.equal(Number((await db.prepare('SELECT mfa_at FROM managed_sessions WHERE token=?').get(storedToken))?.mfa_at), 0);
  const replacementEnrollmentResponse = await beginMfaEnrollmentRoute(new Request(
    'https://studio.fixture/api/identity/mfa/enrollment',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: '{}',
    },
  ));
  const replacementEnrollment = await replacementEnrollmentResponse.json();
  const replacementVerification = await verifyMfaEnrollmentRoute(new Request(
    'https://studio.fixture/api/identity/mfa/enrollment/verify',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ code: totpCode(replacementEnrollment.secret) }),
    },
  ));
  assert.equal(replacementVerification.status, 200);
  const initialBilling = await billingViewRoute(new Request('https://studio.fixture/api/billing', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal(initialBilling.status, 200);
  assert.deepEqual(await initialBilling.json(), {
    mode: 'sandbox',
    enabled: true,
    portalEnabled: false,
    customerReady: false,
    checkout: null,
    ledger: null,
    accessAuthority: 'none',
  });
  const billingRequestId = randomUUID();
  const missingBillingCsrf = await reserveCheckoutRoute(new Request(
    'https://studio.fixture/api/billing/checkouts',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: billingRequestId, offer: 'pro_monthly' }),
    },
  ));
  assert.equal(missingBillingCsrf.status, 403);
  const reservedCheckout = await reserveCheckoutRoute(new Request(
    'https://studio.fixture/api/billing/checkouts',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ key: billingRequestId, offer: 'pro_monthly' }),
    },
  ));
  const reserved = await reservedCheckout.json();
  assert.equal(reservedCheckout.status, 202);
  assert.match(reserved.id, /^[\da-f-]{36}$/);
  const replayedCheckout = await reserveCheckoutRoute(new Request(
    'https://studio.fixture/api/billing/checkouts',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ key: billingRequestId, offer: 'pro_monthly' }),
    },
  ));
  assert.equal((await replayedCheckout.json()).id, reserved.id);
  const changedCheckout = await reserveCheckoutRoute(new Request(
    'https://studio.fixture/api/billing/checkouts',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ key: billingRequestId, offer: 'pro_annual' }),
    },
  ));
  assert.equal(changedCheckout.status, 409);
  const ownedBilling = await billingViewRoute(new Request('https://studio.fixture/api/billing', {
    headers: { Cookie: accountCookies },
  }));
  const ownedBillingView = await ownedBilling.json();
  assert.equal(ownedBillingView.checkout.id, reserved.id);
  assert.equal(ownedBillingView.checkout.state, 'waiting-customer');
  assert.equal(ownedBillingView.checkout.processing, 'created');
  const unopenedCheckout = await openCheckoutRoute(new Request(
    `https://studio.fixture/api/billing/checkouts/${reserved.id}/open`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: '{}',
    },
  ), { params: Promise.resolve({ id: reserved.id }) });
  assert.equal(unopenedCheckout.status, 409);
  const unavailablePortal = await billingPortalRoute(new Request('https://studio.fixture/api/billing/portal', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: '{}',
  }));
  assert.equal(unavailablePortal.status, 503);
  const compressedWebhook = await stripeWebhookRoute(new Request('https://studio.fixture/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Stripe-Signature': `t=${Math.floor(Date.now() / 1000)},v1=fixture`,
    },
    body: '{}',
  }));
  assert.equal(compressedWebhook.status, 415);
  const invalidWebhook = await stripeWebhookRoute(new Request('https://studio.fixture/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': `t=${Math.floor(Date.now() / 1000)},v1=fixture`,
    },
    body: '{}',
  }));
  assert.equal(invalidWebhook.status, 403);
  const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY!, { apiVersion: stripeApiVersion });
  const unsupportedEvent = JSON.stringify({
    id: 'evt_NextUnsupportedFixture',
    object: 'event',
    type: 'fixture.unsupported',
    api_version: stripeApiVersion,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'obj_NextUnsupportedFixture', object: 'fixture.object' } },
  });
  const unsupportedSignature = stripe.webhooks.generateTestHeaderString({
    payload: unsupportedEvent,
    secret: process.env.STRIPE_TEST_WEBHOOK_SECRET!,
  });
  const acceptedWebhook = await stripeWebhookRoute(new Request('https://studio.fixture/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': unsupportedSignature },
    body: unsupportedEvent,
  }));
  assert.deepEqual(await acceptedWebhook.json(), { accepted: true, duplicate: false });
  const replayedWebhook = await stripeWebhookRoute(new Request('https://studio.fixture/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': unsupportedSignature },
    body: unsupportedEvent,
  }));
  assert.deepEqual(await replayedWebhook.json(), { accepted: true, duplicate: true });
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM stripe_event_notifications').get())?.count, 1);
  await assert.rejects(admitSocialIdentity(loadAuthSettings()!, {
    provider: 'google',
    providerAccountId: 'different-invited-subject',
    type: 'oauth',
  }, {
    name: 'Different Invited Person',
    email: 'next-auth-owner@example.test',
    email_verified: true,
  }, authOwner), /Sign out before registering/);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM managed_identities WHERE subject=?')
    .get('different-invited-subject'))?.count, 0);
  const missingCsrf = await profileRoute(new Request('https://studio.fixture/api/profile', {
    method: 'PATCH',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Updated Next Owner' }),
  }));
  assert.equal(missingCsrf.status, 403);
  const profileResponse = await profileRoute(new Request('https://studio.fixture/api/profile', {
    method: 'PATCH',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ name: 'Updated Next Owner' }),
  }));
  assert.equal(profileResponse.status, 200);
  assert.equal((await profileResponse.json()).name, 'Updated Next Owner');
  const reportRequestId = randomUUID();
  const reportResponse = await saveCommunityReportRoute(new Request('https://studio.fixture/api/community/reports', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      requestId: reportRequestId,
      targetType: 'post',
      targetId: postId,
      category: 'misinformation',
      details: 'This fixture report records a concrete policy concern for review by the moderation queue.',
    }),
  }));
  const reportReceipt = await reportResponse.json();
  assert.equal(reportResponse.status, 201);
  assert.equal(reportReceipt.requestId, reportRequestId);
  assert.equal(reportReceipt.delivery, 'moderation-queue-only');
  const reportHistory = await communityReportsRoute(new Request('https://studio.fixture/api/community/reports', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await reportHistory.json()).reports[0].id, reportReceipt.id);
  const muteResponse = await setCommunityMuteRoute(new Request('https://studio.fixture/api/community/mutes', {
    method: 'PUT',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ requestId: randomUUID(), muted: true, targetType: 'post', targetId: postId }),
  }));
  const muteReceipt = await muteResponse.json();
  assert.equal(muteReceipt.muted, true);
  const muteHistory = await communityMutesRoute(new Request('https://studio.fixture/api/community/mutes', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await muteHistory.json()).mutes[0].id, muteReceipt.id);
  const unmuteResponse = await setCommunityMuteRoute(new Request('https://studio.fixture/api/community/mutes', {
    method: 'PUT',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      requestId: randomUUID(),
      muted: false,
      muteId: muteReceipt.id,
      revision: muteReceipt.revision,
    }),
  }));
  assert.equal((await unmuteResponse.json()).muted, false);
  const blockResponse = await setCommunityBlockRoute(new Request('https://studio.fixture/api/community/blocks', {
    method: 'PUT',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ requestId: randomUUID(), blocked: true, targetType: 'post', targetId: postId }),
  }));
  const blockReceipt = await blockResponse.json();
  assert.equal(blockReceipt.blocked, true);
  const blockHistory = await communityBlocksRoute(new Request('https://studio.fixture/api/community/blocks', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await blockHistory.json()).blocks[0].id, blockReceipt.id);
  const unblockResponse = await setCommunityBlockRoute(new Request('https://studio.fixture/api/community/blocks', {
    method: 'PUT',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      requestId: randomUUID(),
      blocked: false,
      blockId: blockReceipt.id,
      revision: blockReceipt.revision,
    }),
  }));
  assert.equal((await unblockResponse.json()).blocked, false);
  const hiddenPostId = 'next-owned-hidden-post';
  await db.prepare(`INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).run(hiddenPostId, 'questions', 'Owned hidden fixture post',
      'This owned fixture post has enough original detail to exercise the member appeal workflow.',
      'Fixture Company', 'system-design', 'Senior', 'Global', 'Anonymous', authOwner, new Date().toISOString());
  await db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
    VALUES('post',?,'hidden',1,?)`).run(hiddenPostId, new Date().toISOString());
  const appealResponse = await saveCommunityAppealRoute(new Request('https://studio.fixture/api/community/appeals', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      requestId: randomUUID(),
      targetType: 'post',
      targetId: hiddenPostId,
      targetRevision: 1,
      statement: 'This original contribution should receive a second policy review with its full saved context.',
    }),
  }));
  const appealReceipt = await appealResponse.json();
  assert.equal(appealResponse.status, 201);
  assert.equal(appealReceipt.appealedTargetRevision, 1);
  const appealHistory = await communityAppealsRoute(new Request('https://studio.fixture/api/community/appeals', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await appealHistory.json()).appeals[0].id, appealReceipt.id);
  const createdPostResponse = await createPostRoute(new Request('https://studio.fixture/api/posts', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      kind: 'questions',
      title: 'How should retry-safe writes be explained?',
      body: 'I want to explain idempotency keys, transaction boundaries, and the response-loss case without hiding trade-offs.',
      company: '',
      track: 'system-design',
      level: 'Senior',
      region: 'Global',
    }),
  }));
  const createdPostId = (await createdPostResponse.json()).id;
  assert.equal(createdPostResponse.status, 201);
  const voteResponse = await postActionRoute(new Request('https://studio.fixture/api/posts/actions', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ id: createdPostId, action: 'vote', enabled: true }),
  }));
  assert.equal(voteResponse.status, 200);
  const ownedPostResponse = await ownedPostRoute(new Request(
    `https://studio.fixture/api/posts/owned?id=${createdPostId}`,
    { headers: { Cookie: accountCookies } },
  ));
  const ownedPost = await ownedPostResponse.json();
  assert.equal(ownedPost.revision, 0);
  const updatedPostResponse = await updateOwnedPostRoute(new Request('https://studio.fixture/api/posts/owned', {
    method: 'PUT',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      id: createdPostId,
      revision: ownedPost.revision,
      title: 'How should retry-safe writes be explained clearly?',
      body: 'I want to explain idempotency keys, transaction boundaries, durable receipts, and the response-loss case without hiding trade-offs.',
    }),
  }));
  const updatedPost = await updatedPostResponse.json();
  assert.equal(updatedPost.revision, 1);
  const submissionRequestId = randomUUID();
  const commentSubmissionResponse = await createCommentSubmissionRoute(new Request(
    'https://studio.fixture/api/comments/submissions',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        requestId: submissionRequestId,
        resource: `post/${createdPostId}`,
        parentId: null,
        body: 'Start with the persisted idempotency record, then explain why it must commit with the business mutation.',
      }),
    },
  ));
  const commentSubmission = await commentSubmissionResponse.json();
  assert.equal(commentSubmission.receipt.requestId, submissionRequestId);
  const commentId = commentSubmission.receipt.commentId;
  const submissionReceipt = await commentSubmissionReceiptRoute(new Request(
    `https://studio.fixture/api/comments/submissions/receipt?requestId=${submissionRequestId}`,
    { headers: { Cookie: accountCookies } },
  ));
  assert.equal((await submissionReceipt.json()).receipt.commentId, commentId);
  const submissionHistory = await commentSubmissionHistoryRoute(new Request(
    `https://studio.fixture/api/comments/submissions?resource=${encodeURIComponent(`post/${createdPostId}`)}`,
    { headers: { Cookie: accountCookies } },
  ));
  assert.equal((await submissionHistory.json()).submissions[0].receipt.commentId, commentId);
  const ownedCommentResponse = await ownedCommentRoute(new Request(
    `https://studio.fixture/api/comments/owned?id=${commentId}`,
    { headers: { Cookie: accountCookies } },
  ));
  const ownedComment = await ownedCommentResponse.json();
  assert.equal(ownedComment.revision, 0);
  const updatedCommentResponse = await updateOwnedCommentRoute(new Request('https://studio.fixture/api/comments/owned', {
    method: 'PUT',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      id: commentId,
      revision: ownedComment.revision,
      body: 'Start with the persisted idempotency record, then explain why the receipt and business mutation commit together.',
    }),
  }));
  const updatedComment = await updatedCommentResponse.json();
  assert.equal(updatedComment.revision, 1);
  process.env.COMMUNITY_WRITES_ENABLED = 'false';
  const pausedBootstrap = await bootstrap(new Request('https://studio.fixture/api/bootstrap', { headers: { Cookie: accountCookies } }));
  assert.equal((await pausedBootstrap.json()).capabilities.community, 'read-only');
  const pausedRoutes = [
    [createPostRoute, '/api/posts', 'POST'],
    [postActionRoute, '/api/posts/actions', 'POST'],
    [createCommentRoute, '/api/comments', 'POST'],
    [createCommentSubmissionRoute, '/api/comments/submissions', 'POST'],
    [updateOwnedPostRoute, '/api/posts/owned', 'PUT'],
    [updateOwnedCommentRoute, '/api/comments/owned', 'PUT'],
  ] as const;
  const beforePaused = await db.prepare('SELECT count(*) AS count FROM comments').get();
  for (const [route, path, method] of pausedRoutes) {
    const result = await route(new Request(`https://studio.fixture${path}`, {
      method, headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}',
    }));
    assert.equal(result.status, 403, path);
  }
  assert.deepEqual(await db.prepare('SELECT count(*) AS count FROM comments').get(), beforePaused);
  const deletedCommentResponse = await deleteOwnedCommentRoute(new Request('https://studio.fixture/api/comments/owned', {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ id: commentId, revision: 1, requestId: randomUUID() }),
  }));
  assert.equal((await deletedCommentResponse.json()).receipt.status, 'tombstoned');
  process.env.COMMUNITY_WRITES_ENABLED = 'true';
  const directCommentResponse = await createCommentRoute(new Request('https://studio.fixture/api/comments', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      resource: `post/${createdPostId}`,
      parentId: null,
      body: 'A second direct comment verifies the compatibility creation response.',
    }),
  }));
  assert.equal((await directCommentResponse.json()).comment.isMine, true);
  process.env.COMMUNITY_WRITES_ENABLED = 'false';
  const deletedPostResponse = await deleteOwnedPostRoute(new Request('https://studio.fixture/api/posts/owned', {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ id: createdPostId, revision: updatedPost.revision }),
  }));
  assert.deepEqual(await deletedPostResponse.json(), { deleted: true });
  process.env.COMMUNITY_WRITES_ENABLED = 'true';
  const restrictionId = randomUUID();
  const now = new Date();
  const restrictionExpires = new Date(now.getTime() + 3600000).toISOString();
  await db.prepare(`INSERT INTO community_restrictions
    (id,subject_id,source_report_id,scope,state,revision,starts_at,expires_at,created_at,updated_at)
    VALUES(?::uuid,?,?::uuid,'participation','active',1,?,?,?,?)`).run(
    restrictionId,
    authOwner,
    reportReceipt.id,
    now.toISOString(),
    restrictionExpires,
    now.toISOString(),
    now.toISOString(),
  );
  await db.prepare(`INSERT INTO community_restriction_events
    (id,restriction_id,source_report_id,actor_ref,actor_role,action,reason,prior_revision,result_revision,
      prior_expires_at,result_expires_at,result_state,created_at)
    VALUES(?::uuid,?::uuid,?::uuid,'fixture.bootstrap','administrator','restrict',?,0,1,NULL,?,'active',?)`).run(
    randomUUID(),
    restrictionId,
    reportReceipt.id,
    'Record a reviewed fixture restriction before exercising staff queue reads.',
    restrictionExpires,
    now.toISOString(),
  );
  const restrictionStatus = await communityRestrictionsRoute(new Request(
    'https://studio.fixture/api/community/restrictions',
    { headers: { Cookie: accountCookies } },
  ));
  assert.equal((await restrictionStatus.json()).restrictions[0].id, restrictionId);
  const restrictionAppealResponse = await saveCommunityRestrictionAppealRoute(new Request(
    'https://studio.fixture/api/community/restriction-appeals',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        requestId: randomUUID(),
        restrictionId,
        restrictionRevision: 1,
        statement: 'Please review this active restriction against the complete contribution and account context.',
      }),
    },
  ));
  const restrictionAppeal = await restrictionAppealResponse.json();
  assert.equal(restrictionAppealResponse.status, 201);
  assert.equal(restrictionAppeal.appealedRestrictionRevision, 1);
  const restrictionAppealHistory = await communityRestrictionAppealsRoute(new Request(
    'https://studio.fixture/api/community/restriction-appeals',
    { headers: { Cookie: accountCookies } },
  ));
  assert.equal((await restrictionAppealHistory.json()).appeals[0].id, restrictionAppeal.id);
  await db.prepare(`INSERT INTO staff_role_events(id,user_id,role,state,actor_ref,reason,ends_at)
    VALUES(?,?,'administrator','granted','fixture.bootstrap',?,clock_timestamp()+interval '1 day')`).run(
    randomUUID(),
    authOwner,
    'Grant bounded fixture administration access for Next.js staff read acceptance.',
  );
  await db.prepare(`INSERT INTO staff_audit_events(id,actor_ref,actor_role,target_ref,action,reason)
    VALUES(?,'fixture.bootstrap',NULL,?,'staff.role.granted',?)`).run(
    randomUUID(),
    authOwner,
    'Record the bounded fixture staff grant for immutable read-surface acceptance.',
  );
  await db.prepare(`UPDATE managed_sessions SET authenticated_at=${'floor(extract(epoch from clock_timestamp())*1000)::bigint'},
    mfa_at=${'floor(extract(epoch from clock_timestamp())*1000)::bigint'} WHERE token=?`).run(storedToken);
  const activeCredential = await db.prepare(`
    SELECT secret_ciphertext,status,pending_expires,last_used_step,created_at,verified_at,updated_at
    FROM managed_totp_credentials WHERE user_id=?
  `).get(authOwner);
  await db.prepare('DELETE FROM managed_totp_credentials WHERE user_id=?').run(authOwner);
  const staffWithoutCredential = await staffSessionRoute(new Request('https://studio.fixture/api/staff/session', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal(staffWithoutCredential.status, 403);
  await db.prepare(`
    INSERT INTO managed_totp_credentials
      (user_id,secret_ciphertext,status,pending_expires,last_used_step,created_at,verified_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(authOwner, activeCredential?.secret_ciphertext, activeCredential?.status,
    activeCredential?.pending_expires, activeCredential?.last_used_step, activeCredential?.created_at,
    activeCredential?.verified_at, activeCredential?.updated_at);
  const staffSessionResponse = await staffSessionRoute(new Request('https://studio.fixture/api/staff/session', {
    headers: { Cookie: accountCookies },
  }));
  assert.deepEqual(await staffSessionResponse.json(), {
    roles: ['administrator'],
    mfa: true,
    fresh: true,
  });
  const staffAccountsResponse = await staffAccountsRoute(new Request(
    'https://studio.fixture/api/staff/accounts?email=next-auth-owner%40example.test',
    { headers: { Cookie: accountCookies } },
  ));
  assert.equal((await staffAccountsResponse.json()).accounts[0].id, authOwner);
  const staffAuditResponse = await staffAuditRoute(new Request('https://studio.fixture/api/staff/audit', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await staffAuditResponse.json()).events[0].action, 'staff.role.granted');
  const staffSupportResponse = await staffSupportRoute(new Request('https://studio.fixture/api/staff/support', {
    headers: { Cookie: accountCookies },
  }));
  assert.deepEqual((await staffSupportResponse.json()).tickets, []);
  const staffReportsResponse = await staffReportsRoute(new Request(
    'https://studio.fixture/api/staff/community/reports',
    { headers: { Cookie: accountCookies } },
  ));
  const staffReport = (await staffReportsResponse.json()).reports[0];
  assert.equal(staffReport.id, reportReceipt.id);
  const staffAppealsResponse = await staffAppealsRoute(new Request(
    'https://studio.fixture/api/staff/community/appeals',
    { headers: { Cookie: accountCookies } },
  ));
  const staffAppeal = (await staffAppealsResponse.json()).appeals[0];
  assert.equal(staffAppeal.id, appealReceipt.id);
  const staffRestrictionsResponse = await staffRestrictionsRoute(new Request(
    'https://studio.fixture/api/staff/community/restrictions',
    { headers: { Cookie: accountCookies } },
  ));
  const staffRestriction = (await staffRestrictionsResponse.json()).restrictions[0];
  assert.equal(staffRestriction.id, restrictionId);
  const staffRestrictionAppealsResponse = await staffRestrictionAppealsRoute(new Request(
    'https://studio.fixture/api/staff/community/restriction-appeals',
    { headers: { Cookie: accountCookies } },
  ));
  const staffRestrictionAppeal = (await staffRestrictionAppealsResponse.json()).appeals[0];
  assert.equal(staffRestrictionAppeal.id, restrictionAppeal.id);
  const claimedReportResponse = await actOnStaffReportRoute(new Request(
    `https://studio.fixture/api/staff/community/reports/${staffReport.id}`,
    {
      method: 'PATCH',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        revision: staffReport.revision,
        targetRevision: staffReport.targetRevision,
        action: 'claim',
        reason: 'Claim this fixture report before saving a reviewed moderation decision.',
      }),
    },
  ), { params: Promise.resolve({ id: staffReport.id }) });
  const claimedReport = await claimedReportResponse.json();
  assert.equal(claimedReport.assignment, 'me');
  const reviewedTriageResponse = await reviewStaffTriageRoute(new Request(
    `https://studio.fixture/api/staff/community/reports/${staffReport.id}/triage`,
    {
      method: 'PATCH',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        revision: claimedReport.triage.revision,
        decision: 'rejected',
        reason: 'The deterministic signal is retained as evidence but does not establish a policy violation.',
      }),
    },
  ), { params: Promise.resolve({ id: staffReport.id }) });
  assert.equal((await reviewedTriageResponse.json()).triage.state, 'reviewed');
  const appliedRestrictionResponse = await applyStaffRestrictionRoute(new Request(
    `https://studio.fixture/api/staff/community/reports/${staffReport.id}/restrictions`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        reportRevision: claimedReport.revision,
        targetRevision: claimedReport.targetRevision,
        subject: 'author',
        scope: 'participation',
        durationHours: 24,
        reason: 'Apply a bounded reviewed fixture restriction to the reported contribution author.',
      }),
    },
  ), { params: Promise.resolve({ id: staffReport.id }) });
  assert.equal((await appliedRestrictionResponse.json()).scope, 'participation');
  const claimedAppealResponse = await actOnStaffAppealRoute(new Request(
    `https://studio.fixture/api/staff/community/appeals/${staffAppeal.id}`,
    {
      method: 'PATCH',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        revision: staffAppeal.revision,
        targetRevision: staffAppeal.targetRevision,
        action: 'claim',
        reason: 'Claim this fixture appeal before a separately reviewed final disposition.',
      }),
    },
  ), { params: Promise.resolve({ id: staffAppeal.id }) });
  assert.equal((await claimedAppealResponse.json()).assignment, 'me');
  const claimedRestrictionAppealResponse = await actOnStaffRestrictionAppealRoute(new Request(
    `https://studio.fixture/api/staff/community/restriction-appeals/${staffRestrictionAppeal.id}`,
    {
      method: 'PATCH',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        revision: staffRestrictionAppeal.revision,
        restrictionRevision: staffRestrictionAppeal.restrictionRevision,
        action: 'claim',
        reason: 'Claim this restriction appeal before a separately reviewed final disposition.',
      }),
    },
  ), { params: Promise.resolve({ id: staffRestrictionAppeal.id }) });
  assert.equal((await claimedRestrictionAppealResponse.json()).assignment, 'me');
  const liftedRestrictionResponse = await changeStaffRestrictionRoute(new Request(
    `https://studio.fixture/api/staff/community/restrictions/${staffRestriction.id}`,
    {
      method: 'PATCH',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        action: 'lift',
        revision: staffRestriction.revision,
        reason: 'Lift the bounded fixture restriction after its acceptance checks have completed.',
      }),
    },
  ), { params: Promise.resolve({ id: staffRestriction.id }) });
  assert.equal((await liftedRestrictionResponse.json()).status, 'lifted');
  const managedTarget = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const managedTargetIdentity = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,?,0)')
    .run(managedTarget, 'Managed status target', null, null);
  await db.prepare(`INSERT INTO managed_identities(id,user_id,issuer,subject,provider,email,verified,available)
    VALUES(?,?,?,?,?,?,1,1)`).run(
    managedTargetIdentity,
    managedTarget,
    'https://accounts.google.com',
    'managed-target-subject',
    'google',
    'managed-target@example.test',
  );
  await db.prepare(`INSERT INTO managed_accounts(user_id,status,contact_email,contact_identity_id,contact_verified)
    VALUES(?,'active','managed-target@example.test',?,1)`).run(managedTarget, managedTargetIdentity);
  const suspendedTargetResponse = await changeStaffAccountStatusRoute(new Request(
    `https://studio.fixture/api/staff/accounts/${managedTarget}/status`,
    {
      method: 'PATCH',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        status: 'suspended',
        revision: 0,
        reason: 'Suspend the isolated fixture account to verify audited status mutation authority.',
      }),
    },
  ), { params: Promise.resolve({ id: managedTarget }) });
  assert.equal((await suspendedTargetResponse.json()).status, 'suspended');
  const missingLearningCsrf = await updateProgressRoute(new Request('https://studio.fixture/api/progress', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'system-design/introduction', field: 'read', enabled: true }),
  }));
  assert.equal(missingLearningCsrf.status, 403);
  const progressResponse = await updateProgressRoute(new Request('https://studio.fixture/api/progress', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ key: 'system-design/introduction', field: 'read', enabled: true }),
  }));
  const progressState = await progressResponse.json();
  assert.equal(progressResponse.status, 200);
  assert.ok(progressState.read.includes('system-design/introduction'));
  assert.equal(progressState.recognition, 5);
  const premiumProgress = await updateProgressRoute(new Request('https://studio.fixture/api/progress', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ key: 'low-level-design/concurrency', field: 'read', enabled: true }),
  }));
  assert.equal(premiumProgress.status, 403);
  const enrollment = await enrollCourseRoute(new Request('https://studio.fixture/api/courses/system-design/enroll', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: '{}',
  }), { params: Promise.resolve({ id: 'system-design' }) });
  assert.ok((await enrollment.json()).enrollments.includes('system-design'));
  const videoProgress = await saveCourseVideoRoute(new Request('https://studio.fixture/api/courses/system-design/video', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ resource: 'system-design' }),
  }), { params: Promise.resolve({ id: 'system-design' }) });
  assert.ok((await videoProgress.json()).watched.includes('system-design'));
  const quizCreation = await createQuizSessionRoute(new Request('https://studio.fixture/api/quiz-sessions', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ topic: 'api-design' }),
  }));
  assert.equal(quizCreation.status, 201);
  let quizSession = await quizCreation.json();
  const quizId = quizSession.id;
  const openQuizList = await listQuizSessionsRoute(new Request('https://studio.fixture/api/quiz-sessions', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await openQuizList.json())[0].id, quizId);
  const resumedQuiz = await quizSessionRoute(new Request(`https://studio.fixture/api/quiz-sessions/${quizId}`, {
    headers: { Cookie: accountCookies },
  }), { params: Promise.resolve({ id: quizId }) });
  assert.equal((await resumedQuiz.json()).id, quizId);
  while (quizSession.question) {
    const answered = await answerQuizSessionRoute(new Request(
      `https://studio.fixture/api/quiz-sessions/${quizId}/answer`,
      {
        method: 'POST',
        headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          questionId: quizSession.question.id,
          answer: -1,
          revision: quizSession.revision,
        }),
      },
    ), { params: Promise.resolve({ id: quizId }) });
    assert.equal(answered.status, 200);
    quizSession = (await answered.json()).session;
  }
  const finishedQuiz = await finishQuizSessionRoute(new Request(
    `https://studio.fixture/api/quiz-sessions/${quizId}/finish`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ revision: quizSession.revision }),
    },
  ), { params: Promise.resolve({ id: quizId }) });
  const finishedQuizState = await finishedQuiz.json();
  assert.equal(finishedQuiz.status, 200);
  assert.equal(finishedQuizState.quizzes[0].id, quizId);
  const savedQuizReport = await quizReportRoute(new Request(`https://studio.fixture/api/quiz-reports/${quizId}`, {
    headers: { Cookie: accountCookies },
  }), { params: Promise.resolve({ id: quizId }) });
  assert.equal((await savedQuizReport.json()).id, quizId);
  const closedQuizList = await listQuizSessionsRoute(new Request('https://studio.fixture/api/quiz-sessions', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await closedQuizList.json()).length, 0);
  const targetResponse = await createTargetRoute(new Request('https://studio.fixture/api/targets', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ company: 'Fixture Company', level: 'Senior', role: 'Platform engineer', date: '2027-02-28' }),
  }));
  const targetState = await targetResponse.json();
  const targetId = targetState.targets[0].id;
  assert.equal(targetState.targets[0].company, 'Fixture Company');
  const invalidTargetDate = await createTargetRoute(new Request('https://studio.fixture/api/targets', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ company: 'Invalid Date Company', level: 'Senior', role: 'Engineer', date: '2027-02-29' }),
  }));
  assert.equal(invalidTargetDate.status, 400);
  const storyInput = {
    title: 'Stabilizing a shared release',
    situation: 'Two teams needed to publish through the same release path.',
    task: 'I had to make ownership and rollback behavior explicit.',
    action: 'I introduced a bounded checklist, exact artifact identity, and a rehearsed rollback.',
    result: 'The release completed predictably and the next team reused the same evidence.',
    tags: ['ownership', 'reliability'],
    revision: 0,
  };
  const createdStoryResponse = await saveStoryRoute(new Request('https://studio.fixture/api/stories', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(storyInput),
  }));
  const createdStoryState = await createdStoryResponse.json();
  const storyId = createdStoryState.stories[0].id;
  assert.equal(createdStoryState.stories[0].revision, 0);
  const updatedStoryResponse = await saveStoryRoute(new Request('https://studio.fixture/api/stories', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ ...storyInput, id: storyId, title: 'Stabilizing a shared production release' }),
  }));
  assert.equal((await updatedStoryResponse.json()).stories[0].revision, 1);
  const staleStory = await saveStoryRoute(new Request('https://studio.fixture/api/stories', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ ...storyInput, id: storyId, title: 'Stale replacement' }),
  }));
  assert.equal(staleStory.status, 409);
  const deletedStory = await deleteStoryRoute(new Request(`https://studio.fixture/api/stories/${storyId}`, {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'X-CSRF-Token': csrf },
  }), { params: Promise.resolve({ id: storyId }) });
  assert.equal((await deletedStory.json()).stories.length, 0);
  const deletedTarget = await deleteTargetRoute(new Request(`https://studio.fixture/api/targets/${targetId}`, {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'X-CSRF-Token': csrf },
  }), { params: Promise.resolve({ id: targetId }) });
  assert.equal((await deletedTarget.json()).targets.length, 0);
  const attemptInput = {
    problemId: 'short-links',
    level: 'Senior',
    answer: 'Use a durable key mapping, an idempotent create operation, and bounded redirects.',
    code: '',
    nodes: [
      { id: 'api', label: 'API', x: 20, y: 30 },
      { id: 'db', label: 'Database', x: 70, y: 30 },
    ],
    edges: [['api', 'db']],
    elapsed: 180,
    revision: 0,
  };
  const createdAttemptResponse = await saveAttemptRoute(new Request('https://studio.fixture/api/attempts', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(attemptInput),
  }));
  const createdAttempt = await createdAttemptResponse.json();
  const attemptId = createdAttempt.attempt.id;
  assert.equal(createdAttempt.attempt.revision, 0);
  const updatedAttemptResponse = await saveAttemptRoute(new Request('https://studio.fixture/api/attempts', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ ...attemptInput, id: attemptId, answer: `${attemptInput.answer} Cache hot redirects.` }),
  }));
  assert.equal((await updatedAttemptResponse.json()).attempt.revision, 1);
  const evaluatedAttemptResponse = await evaluateAttemptRoute(new Request(
    `https://studio.fixture/api/attempts/${attemptId}/evaluate`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: '{}',
    },
  ), { params: Promise.resolve({ id: attemptId }) });
  const evaluatedAttemptState = await evaluatedAttemptResponse.json();
  const evaluatedAttempt = evaluatedAttemptState.attempts.find((attempt: { id: string }) => attempt.id === attemptId);
  assert.equal(evaluatedAttemptResponse.status, 200);
  assert.equal(evaluatedAttempt.completed, true);
  assert.equal(evaluatedAttempt.feedback.source, 'rubric');
  const repeatedEvaluation = await evaluateAttemptRoute(new Request(
    `https://studio.fixture/api/attempts/${attemptId}/evaluate`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: '{}',
    },
  ), { params: Promise.resolve({ id: attemptId }) });
  const repeatedEvaluationState = await repeatedEvaluation.json();
  assert.equal(repeatedEvaluationState.recognition, evaluatedAttemptState.recognition);
  const staleAttempt = await saveAttemptRoute(new Request('https://studio.fixture/api/attempts', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ ...attemptInput, id: attemptId, answer: 'A stale replacement.' }),
  }));
  assert.equal(staleAttempt.status, 409);
  const invalidEdgeAttempt = await saveAttemptRoute(new Request('https://studio.fixture/api/attempts', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ ...attemptInput, edges: [['api', 'missing']] }),
  }));
  assert.equal(invalidEdgeAttempt.status, 400);
  const premiumAttempt = await saveAttemptRoute(new Request('https://studio.fixture/api/attempts', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ ...attemptInput, problemId: 'team-chat' }),
  }));
  assert.equal(premiumAttempt.status, 403);
  const entitlementNow = Number((await db.prepare(
    'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now',
  ).get())?.now);
  await new Entitlements(db).issue({
    owner: authOwner,
    source: { kind: 'engineering', key: 'next-runtime-premium' },
    policy: 'pro-v1',
    startsAt: entitlementNow - 1000,
    endsAt: entitlementNow + 3600000,
    evidence: { actor: 'next-runtime', reason: 'Exercise migrated premium learning Route Handlers.' },
  });
  const mockCreation = await createMockRoute(new Request('https://studio.fixture/api/mocks', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ problemId: 'short-links', company: 'Google', level: 'Senior', length: 3 }),
  }));
  const mockCreated = await mockCreation.json();
  const mockId = mockCreated.session.id;
  let mockSession = mockCreated.session;
  while (!mockSession.completedAt) {
    const draftStateResponse = await saveMockDraftRoute(new Request(
      `https://studio.fixture/api/mocks/${mockId}/draft`,
      {
        method: 'POST',
        headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          revision: mockSession.revision,
          answer: 'I would define an idempotent key allocation contract, durable storage, cache behavior, and observable failure handling.',
        }),
      },
    ), { params: Promise.resolve({ id: mockId }) });
    mockSession = (await draftStateResponse.json()).mocks.find((mock: { id: string }) => mock.id === mockId);
    const responseState = await respondToMockRoute(new Request(
      `https://studio.fixture/api/mocks/${mockId}/respond`,
      {
        method: 'POST',
        headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ revision: mockSession.revision }),
      },
    ), { params: Promise.resolve({ id: mockId }) });
    mockSession = (await responseState.json()).mocks.find((mock: { id: string }) => mock.id === mockId);
  }
  assert.equal(mockSession.turns.length, 3);
  assert.equal(mockSession.turns[0].feedback.source, 'rubric');
  const customQuizCreation = await createCustomQuizRoute(new Request('https://studio.fixture/api/custom-quizzes', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ title: 'API decisions', topics: ['api-design'], mode: 'all', count: 1 }),
  }));
  const customQuizCreated = await customQuizCreation.json();
  const customQuizId = customQuizCreated.quiz.id;
  const customQuestionResponse = await customQuizQuestionRoute(new Request(
    `https://studio.fixture/api/custom-quizzes/${customQuizId}/question`,
    { headers: { Cookie: accountCookies } },
  ), { params: Promise.resolve({ id: customQuizId }) });
  const customQuestion = await customQuestionResponse.json();
  const customAnswerResponse = await answerCustomQuizRoute(new Request(
    `https://studio.fixture/api/custom-quizzes/${customQuizId}/answer`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ revision: 0, questionId: customQuestion.id, answer: -1 }),
    },
  ), { params: Promise.resolve({ id: customQuizId }) });
  const answeredCustomQuizState = await customAnswerResponse.json();
  const answeredCustomQuiz = answeredCustomQuizState.state.customQuizzes.find(
    (quiz: { id: string }) => quiz.id === customQuizId,
  );
  const finishedCustomQuizResponse = await finishCustomQuizRoute(new Request(
    `https://studio.fixture/api/custom-quizzes/${customQuizId}/finish`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ revision: answeredCustomQuiz.revision }),
    },
  ), { params: Promise.resolve({ id: customQuizId }) });
  const finishedCustomQuiz = (await finishedCustomQuizResponse.json()).customQuizzes.find(
    (quiz: { id: string }) => quiz.id === customQuizId,
  );
  assert.equal(finishedCustomQuiz.score, 0);
  assert.equal(typeof finishedCustomQuiz.completedAt, 'string');
  const planCreation = await createStudyPlanRoute(new Request('https://studio.fixture/api/study-plans', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      company: 'Google',
      level: 'Senior',
      weeks: 2,
      sessionsPerWeek: 5,
      startOn: '2027-01-04',
    }),
  }));
  const planCreated = await planCreation.json();
  const planId = planCreated.plan.id;
  const reflection = planCreated.plan.tasks.find((task: { kind: string }) => task.kind === 'reflection');
  const reflectedPlanResponse = await savePlanReflectionRoute(new Request(
    `https://studio.fixture/api/study-plans/${planId}/reflection`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        taskId: reflection.id,
        note: 'I would state the consistency boundary earlier and test the retry path explicitly.',
        revision: 0,
      }),
    },
  ), { params: Promise.resolve({ id: planId }) });
  const reflectedPlan = (await reflectedPlanResponse.json()).studyPlans.find(
    (plan: { id: string }) => plan.id === planId,
  );
  assert.equal(reflectedPlan.revision, 1);
  const staleReflection = await savePlanReflectionRoute(new Request(
    `https://studio.fixture/api/study-plans/${planId}/reflection`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        taskId: reflection.id,
        note: 'This stale reflection must not replace the newer saved note.',
        revision: 0,
      }),
    },
  ), { params: Promise.resolve({ id: planId }) });
  assert.equal(staleReflection.status, 409);
  const projectCreation = await createProjectRoute(new Request('https://studio.fixture/api/projects', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      title: 'Event deduplication project',
      problemId: 'event-dedup',
      files: [{ path: 'events.js', content: 'export function solve(input) { return input; }\n' }],
    }),
  }));
  const projectCreated = await projectCreation.json();
  const projectId = projectCreated.project.id;
  assert.match(projectCreated.project.briefVersion, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(projectCreated.project.brief).includes('keywords'));
  const pinnedProjectProblem = await problem(new Request(
    `https://studio.fixture/api/content/problems/event-dedup?project=${projectId}`,
    { headers: { Cookie: accountCookies } },
  ), { params: Promise.resolve({ id: 'event-dedup' }) });
  assert.equal(pinnedProjectProblem.headers.get('X-Content-Version'), projectCreated.project.briefVersion);
  const projectSave = await saveProjectRoute(new Request(
    `https://studio.fixture/api/projects/${projectId}/save`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        revision: 0,
        files: [{
          path: 'events.js',
          content: 'export function solve(input) { const seen = new Set(); return input.filter(event => !seen.has(event.id) && seen.add(event.id)); }\n',
        }],
        explanation: 'A Set preserves the first event for each identifier while retaining the original input order.',
        verification: 'Ran the browser example checks and reviewed empty and duplicate inputs.',
      }),
    },
  ), { params: Promise.resolve({ id: projectId }) });
  const savedProject = (await projectSave.json()).projects.find((project: { id: string }) => project.id === projectId);
  assert.equal(savedProject.revision, 1);
  const projectReview = await reviewProjectRoute(new Request(
    `https://studio.fixture/api/projects/${projectId}/review`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ revision: savedProject.revision }),
    },
  ), { params: Promise.resolve({ id: projectId }) });
  const reviewedProject = (await projectReview.json()).projects.find(
    (project: { id: string }) => project.id === projectId,
  );
  assert.equal(reviewedProject.feedback.source, 'rubric');
  assert.equal(typeof reviewedProject.completedAt, 'string');
  const staleProjectSave = await saveProjectRoute(new Request(
    `https://studio.fixture/api/projects/${projectId}/save`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        revision: 1,
        files: [{ path: 'events.js', content: 'stale' }],
        explanation: 'This stale project edit must not replace the reviewed saved source snapshot.',
        verification: 'This stale note must not be accepted.',
      }),
    },
  ), { params: Promise.resolve({ id: projectId }) });
  assert.equal(staleProjectSave.status, 409);
  const protectedPathProject = await createProjectRoute(new Request('https://studio.fixture/api/projects', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      title: 'Rejected credential path',
      problemId: 'event-dedup',
      files: [{ path: '.env', content: 'NOT_A_REAL_SECRET=value' }],
    }),
  }));
  assert.equal(protectedPathProject.status, 400);
  const tutorQuestion = await askTutorRoute(new Request('https://studio.fixture/api/tutor', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      question: 'How does cache aside work and what failure should I verify?',
      context: 'I am reviewing the caching lesson.',
    }),
  }));
  const tutorState = await tutorQuestion.json();
  assert.equal(tutorState.chat.at(-2).role, 'user');
  assert.equal(tutorState.chat.at(-1).source, 'rubric');
  assert.match(tutorState.chat.at(-1).text, /^Local study helper \(not AI\):/);
  const clearedTutor = await clearTutorRoute(new Request('https://studio.fixture/api/tutor', {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'X-CSRF-Token': csrf },
  }));
  assert.deepEqual((await clearedTutor.json()).chat, []);
  const otherToken = 'e'.repeat(64);
  await withAuthRequest(new Request('https://studio.fixture/api/auth/callback/google'), async () => {
    recordAuthAdmission({ userId: authOwner, identityId: identity });
    await adapter.createSession!({ sessionToken: otherToken, userId: authOwner, expires: new Date() });
  });
  const withOther = await identitySecurityRoute(new Request('https://studio.fixture/api/identity/security', {
    headers: { Cookie: accountCookies },
  }));
  const otherSession = (await withOther.json()).sessions.find((value: { current: boolean }) => !value.current);
  assert.ok(otherSession);
  const revoked = await revokeSessionRoute(new Request('https://studio.fixture/api/identity/sessions/other', {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'X-CSRF-Token': csrf },
  }), { params: Promise.resolve({ id: otherSession.id }) });
  assert.equal(revoked.status, 200);
  assert.equal(await adapter.getSessionAndUser!(otherToken), null);
  const currentRemoval = await removeIdentityRoute(new Request('https://studio.fixture/api/identity/methods/current', {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'X-CSRF-Token': csrf },
  }), { params: Promise.resolve({ id: identity }) });
  assert.equal(currentRemoval.status, 409);
  const linkStart = await beginIdentityLinkRoute(new Request('https://studio.fixture/api/identity/link', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ provider: 'facebook' }),
  }));
  assert.equal(linkStart.status, 200);
  assert.equal((await linkStart.clone().json()).url, '/api/auth/signin/facebook?callbackUrl=%2Faccount');
  const actionCookie = linkStart.headers.get('Set-Cookie')?.split(';')[0];
  assert.match(actionCookie ?? '', /^__Host-studio_auth_action=[a-f0-9]{64}$/);
  const callbackRequest = new Request('https://studio.fixture/api/auth/callback/facebook', {
    headers: { Cookie: `${accountCookies}; ${actionCookie}` },
  });
  const linked = await withAuthRequest(callbackRequest, () => completeSocialLink(loadAuthSettings()!, {
    provider: 'facebook',
    providerAccountId: 'facebook-subject',
    type: 'oauth',
  }, {
    name: 'Facebook Owner',
    email: 'matching-email-does-not-merge@example.test',
  }));
  assert.equal(linked?.userId, authOwner);
  assert.ok(linked?.identityId);
  await withAuthRequest(callbackRequest,
    () => refreshAdmittedSession(linked!, '__Host-studio_session'));
  assert.equal((await db.prepare('SELECT identity_id FROM managed_sessions WHERE token=?').get(storedToken))?.identity_id,
    linked!.identityId);
  await assert.rejects(withAuthRequest(callbackRequest, () => completeSocialLink(loadAuthSettings()!, {
    provider: 'facebook',
    providerAccountId: 'facebook-subject',
    type: 'oauth',
  }, { name: 'Facebook Owner' })), /expired or no longer matches/);
  const facebookIdentity = linked!.identityId;
  const facebookToken = 'f'.repeat(64);
  await withAuthRequest(new Request('https://studio.fixture/api/auth/callback/facebook'), async () => {
    recordAuthAdmission({ userId: authOwner, identityId: facebookIdentity });
    await adapter.createSession!({ sessionToken: facebookToken, userId: authOwner, expires: new Date() });
  });
  await withAuthRequest(new Request('https://studio.fixture/api/auth/callback/google', {
    headers: { Cookie: `__Host-studio_session=${sessionToken}` },
  }), () => refreshAdmittedSession({ userId: authOwner, identityId: identity }, '__Host-studio_session'));
  const removed = await removeIdentityRoute(new Request('https://studio.fixture/api/identity/methods/facebook', {
    method: 'DELETE',
    headers: { Cookie: accountCookies, 'X-CSRF-Token': csrf },
  }), { params: Promise.resolve({ id: facebookIdentity }) });
  assert.equal(removed.status, 200);
  assert.equal(await adapter.getSessionAndUser!(facebookToken), null);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM managed_identities WHERE id=?').get(facebookIdentity))?.count, 0);
  const exportId = '44444444-4444-4444-8444-444444444444';
  const exportRequest = await requestPrivacyExportRoute(new Request('https://studio.fixture/api/privacy/exports', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ requestId: exportId }),
  }));
  assert.equal(exportRequest.status, 202);
  assert.equal((await exportRequest.json()).id, exportId);
  const exportHistory = await privacyExportsRoute(new Request('https://studio.fixture/api/privacy/exports', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await exportHistory.json()).exports[0].id, exportId);
  const pendingDownload = await downloadPrivacyExportRoute(new Request(
    `https://studio.fixture/api/privacy/exports/${exportId}/download`,
    { headers: { Cookie: accountCookies } },
  ), { params: Promise.resolve({ id: exportId }) });
  assert.equal(pendingDownload.status, 409);
  const emptyDeletion = await privacyDeletionRoute(new Request('https://studio.fixture/api/privacy/deletion', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await emptyDeletion.json()).deletion, null);
  const deletionId = '55555555-5555-4555-8555-555555555555';
  const deletionRequest = await requestPrivacyDeletionRoute(new Request('https://studio.fixture/api/privacy/deletion', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ requestId: deletionId }),
  }));
  assert.equal(deletionRequest.status, 202);
  assert.equal((await deletionRequest.json()).status, 'cooling-off');
  assert.equal((await db.prepare('SELECT status FROM managed_accounts WHERE user_id=?').get(authOwner))?.status,
    'deletion-pending');
  const deletionStatus = await privacyDeletionRoute(new Request('https://studio.fixture/api/privacy/deletion', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await deletionStatus.json()).deletion.id, deletionId);
  const deletionPendingSupport = await saveSupportRoute(new Request('https://studio.fixture/api/support', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      key: '33333333-3333-4333-8333-333333333333',
      email: 'next-auth-owner@example.test',
      body: 'A deletion-pending owner can still ask for help with the account deletion lifecycle.',
    }),
  }));
  assert.equal(deletionPendingSupport.status, 200);
  const deletionPendingProfile = await profileRoute(new Request('https://studio.fixture/api/profile', {
    method: 'PATCH',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ name: 'Must Not Change During Deletion' }),
  }));
  assert.equal(deletionPendingProfile.status, 403);
  const cancellation = await cancelPrivacyDeletionRoute(new Request(
    'https://studio.fixture/api/privacy/deletion/cancel',
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ requestId: deletionId }),
    },
  ));
  assert.equal(cancellation.status, 200);
  assert.equal((await cancellation.json()).status, 'cancelled');
  assert.equal((await db.prepare('SELECT status FROM managed_accounts WHERE user_id=?').get(authOwner))?.status, 'active');
  const supportBody = 'A private support request that remains available when product access is restricted.';
  const supportRequest = await saveSupportRoute(new Request('https://studio.fixture/api/support', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      key: '66666666-6666-4666-8666-666666666666',
      email: 'next-auth-owner@example.test',
      body: supportBody,
    }),
  }));
  assert.equal(supportRequest.status, 200);
  const supportId = (await supportRequest.json()).id;
  const exactRetry = await saveSupportRoute(new Request('https://studio.fixture/api/support', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      key: '66666666-6666-4666-8666-666666666666',
      email: 'next-auth-owner@example.test',
      body: supportBody,
    }),
  }));
  assert.equal((await exactRetry.json()).id, supportId);
  const conflictingRetry = await saveSupportRoute(new Request('https://studio.fixture/api/support', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      key: '66666666-6666-4666-8666-666666666666',
      email: 'next-auth-owner@example.test',
      body: `${supportBody} This changed payload must not replace the original request.`,
    }),
  }));
  assert.equal(conflictingRetry.status, 409);
  const supportHistory = await supportHistoryRoute(new Request('https://studio.fixture/api/support/requests', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal((await supportHistory.json()).tickets[0].id, supportId);
  await db.prepare("DELETE FROM identity_abuse_buckets WHERE scope='account-security'").run();
  await db.prepare(`UPDATE managed_sessions SET authenticated_at=floor(extract(epoch from clock_timestamp())*1000)::bigint,
    mfa_at=floor(extract(epoch from clock_timestamp())*1000)::bigint WHERE token=?`).run(storedToken);
  const staffSupportQueueResponse = await staffSupportRoute(new Request('https://studio.fixture/api/staff/support', {
    headers: { Cookie: accountCookies },
  }));
  const staffSupportQueuePayload = await staffSupportQueueResponse.json();
  assert.equal(staffSupportQueueResponse.status, 200, JSON.stringify(staffSupportQueuePayload));
  const staffTicket = staffSupportQueuePayload.tickets.find(
    (ticket: { id: string }) => ticket.id === supportId,
  );
  const updatedStaffTicketResponse = await updateStaffSupportRoute(new Request(
    `https://studio.fixture/api/staff/support/${supportId}`,
    {
      method: 'PATCH',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        revision: staffTicket.revision,
        assignment: 'me',
        reason: 'Claim this fixture request and record that staff review has started.',
      }),
    },
  ), { params: Promise.resolve({ id: supportId }) });
  const updatedStaffTicket = await updatedStaffTicketResponse.json();
  assert.equal(updatedStaffTicketResponse.status, 200, JSON.stringify(updatedStaffTicket));
  assert.equal(updatedStaffTicket.assignment, 'me');
  const staffReplyResponse = await replyToStaffSupportRoute(new Request(
    `https://studio.fixture/api/staff/support/${supportId}/replies`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        requestId: randomUUID(),
        revision: updatedStaffTicket.revision,
        body: 'Your request is available to the private beta support owner for in-app follow-up.',
      }),
    },
  ), { params: Promise.resolve({ id: supportId }) });
  assert.equal((await staffReplyResponse.json()).ticket.status, 'pending');
  await db.prepare("UPDATE managed_accounts SET status='pending-verification' WHERE user_id=?").run(authOwner);
  const pendingSupport = await saveSupportRoute(new Request('https://studio.fixture/api/support', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      key: '88888888-8888-4888-8888-888888888888',
      email: 'next-auth-owner@example.test',
      body: 'A pending-verification owner can still ask for help completing account admission.',
    }),
  }));
  assert.equal(pendingSupport.status, 200);
  await db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(authOwner);
  const restrictedSupport = await saveSupportRoute(new Request('https://studio.fixture/api/support', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({
      key: '77777777-7777-4777-8777-777777777777',
      email: 'next-auth-owner@example.test',
      body: 'A restricted owner can still save this private support request without product-write authority.',
    }),
  }));
  assert.equal(restrictedSupport.status, 200);
  const restrictedProfile = await profileRoute(new Request('https://studio.fixture/api/profile', {
    method: 'PATCH',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ name: 'Must Not Change' }),
  }));
  assert.equal(restrictedProfile.status, 403);
  const restrictedProgress = await updateProgressRoute(new Request('https://studio.fixture/api/progress', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ key: 'system-design/introduction', field: 'read', enabled: false }),
  }));
  assert.equal(restrictedProgress.status, 403);
  await db.prepare("UPDATE managed_accounts SET status='active' WHERE user_id=?").run(authOwner);
  Object.assign(process.env, {
    MANAGED_AI_ENABLED: 'true',
    MANAGED_AI_MODEL_REVISION: 'next-runtime-model-revision',
    MANAGED_AI_INPUT_PRICE_MICROS_PER_MILLION_TOKENS: '1000000',
    MANAGED_AI_OUTPUT_PRICE_MICROS_PER_MILLION_TOKENS: '2000000',
    MANAGED_AI_DATA_USE_NOTICE: 'Saved practice input is sent to the configured Azure fixture and retained only under the approved private-beta policy.',
    AZURE_OPENAI_API_KEY: 'next-runtime-fixture-key',
    AZURE_OPENAI_ENDPOINT: 'https://next-runtime.openai.azure.com',
    AZURE_OPENAI_DEPLOYMENT: 'next-runtime-deployment',
    AZURE_OPENAI_API_VERSION: '2025-04-01-preview',
  });
  const aiBootstrapResponse = await bootstrap(new Request('https://studio.fixture/api/bootstrap', {
    headers: { Cookie: accountCookies },
  }));
  const aiBootstrap = await aiBootstrapResponse.json();
  assert.equal(aiBootstrapResponse.status, 200);
  assert.equal(aiBootstrap.capabilities.ai, true);
  assert.equal(aiBootstrap.capabilities.aiModel, 'next-runtime-deployment');
  assert.equal(aiBootstrap.capabilities.aiPolicy.consent, 'sandbox-ai-usage-v1');
  const aiAttemptResponse = await saveAttemptRoute(new Request('https://studio.fixture/api/attempts', {
    method: 'POST',
    headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ ...attemptInput, answer: `${attemptInput.answer} This request exercises managed AI admission.` }),
  }));
  const aiAttempt = (await aiAttemptResponse.json()).attempt;
  const aiRequestId = randomUUID();
  const aiBody = {
    requestId: aiRequestId,
    revision: aiAttempt.revision,
    consent: 'sandbox-ai-usage-v1',
    acknowledged: true,
  };
  const missingAiConsent = await evaluateAttemptRoute(new Request(
    `https://studio.fixture/api/attempts/${aiAttempt.id}/evaluate`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ requestId: randomUUID(), revision: aiAttempt.revision }),
    },
  ), { params: Promise.resolve({ id: aiAttempt.id }) });
  assert.equal(missingAiConsent.status, 400);
  const missingAiCsrf = await evaluateAttemptRoute(new Request(
    `https://studio.fixture/api/attempts/${aiAttempt.id}/evaluate`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify(aiBody),
    },
  ), { params: Promise.resolve({ id: aiAttempt.id }) });
  assert.equal(missingAiCsrf.status, 403);
  const queuedAiResponse = await evaluateAttemptRoute(new Request(
    `https://studio.fixture/api/attempts/${aiAttempt.id}/evaluate`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(aiBody),
    },
  ), { params: Promise.resolve({ id: aiAttempt.id }) });
  const queuedAi = await queuedAiResponse.json();
  assert.equal(queuedAiResponse.status, 202);
  assert.equal(queuedAi.state, 'queued');
  const replayedAi = await evaluateAttemptRoute(new Request(
    `https://studio.fixture/api/attempts/${aiAttempt.id}/evaluate`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(aiBody),
    },
  ), { params: Promise.resolve({ id: aiAttempt.id }) });
  assert.equal((await replayedAi.json()).operationId, queuedAi.operationId);
  const changedAi = await evaluateAttemptRoute(new Request(
    `https://studio.fixture/api/attempts/${aiAttempt.id}/evaluate`,
    {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ ...aiBody, revision: aiAttempt.revision + 1 }),
    },
  ), { params: Promise.resolve({ id: aiAttempt.id }) });
  assert.equal(changedAi.status, 409);
  const queuedAiStatus = await aiOperationRoute(new Request(
    `https://studio.fixture/api/ai/operations/${queuedAi.operationId}`,
    { headers: { Cookie: accountCookies } },
  ), { params: Promise.resolve({ id: queuedAi.operationId }) });
  assert.equal((await queuedAiStatus.json()).state, 'queued');
  const anonymousAiStatus = await aiOperationRoute(new Request(
    `https://studio.fixture/api/ai/operations/${queuedAi.operationId}`,
  ), { params: Promise.resolve({ id: queuedAi.operationId }) });
  assert.equal(anonymousAiStatus.status, 401);
  const invalidAiStatus = await aiOperationRoute(new Request(
    'https://studio.fixture/api/ai/operations/not-a-uuid',
    { headers: { Cookie: accountCookies } },
  ), { params: Promise.resolve({ id: 'not-a-uuid' }) });
  assert.equal(invalidAiStatus.status, 404);
  const cancelledAi = await cancelAiOperationRoute(new Request(
    `https://studio.fixture/api/ai/operations/${queuedAi.operationId}`,
    { method: 'DELETE', headers: { Cookie: accountCookies, 'X-CSRF-Token': csrf } },
  ), { params: Promise.resolve({ id: queuedAi.operationId }) });
  assert.equal(cancelledAi.status, 200);
  assert.equal((await cancelledAi.json()).state, 'cancelled');
  const cancelledAiStatus = await aiOperationRoute(new Request(
    `https://studio.fixture/api/ai/operations/${queuedAi.operationId}`,
    { headers: { Cookie: accountCookies } },
  ), { params: Promise.resolve({ id: queuedAi.operationId }) });
  assert.equal((await cancelledAiStatus.json()).state, 'cancelled');
  for (let index = 0; index < 10; index += 1) {
    await db.prepare(`INSERT INTO support(id,user_id,email,body,created_at)
      VALUES(?,?,?,?,?)`).run(`next-owned-support-${index}`, authOwner, 'next-auth-owner@example.test',
      `A paginated owned support fixture request number ${index} with enough detail for validation.`,
      `2026-12-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`);
  }
  const pagedHistory = await supportHistoryRoute(new Request('https://studio.fixture/api/support/requests', {
    headers: { Cookie: accountCookies },
  }));
  const pagedHistoryPayload = await pagedHistory.json();
  assert.equal(pagedHistoryPayload.tickets.length, 10);
  assert.equal(typeof pagedHistoryPayload.nextCursor, 'string');
  const crossOwnerCursor = JSON.parse(Buffer.from(pagedHistoryPayload.nextCursor, 'base64url').toString('utf8'));
  crossOwnerCursor.owner = 'different-support-owner';
  const rejectedCursor = await supportHistoryRoute(new Request(
    `https://studio.fixture/api/support/requests?cursor=${Buffer.from(JSON.stringify(crossOwnerCursor)).toString('base64url')}`,
    { headers: { Cookie: accountCookies } },
  ));
  assert.equal(rejectedCursor.status, 400);
  const anonymousSupport = await saveSupportRoute(new Request('https://studio.fixture/api/support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'anonymous@example.test',
      body: 'Anonymous managed support is intentionally unavailable until trusted edge protection exists.',
    }),
  }));
  assert.equal(anonymousSupport.status, 401);
  let limitedSupport: Response | undefined;
  for (let attempt = 0; attempt < 31; attempt += 1) {
    const response = await saveSupportRoute(new Request('https://studio.fixture/api/support', {
      method: 'POST',
      headers: { Cookie: accountCookies, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ key: randomUUID(), email: 'invalid', body: 'invalid' }),
    }));
    if (response.status === 429) {
      limitedSupport = response;
      break;
    }
    assert.equal(response.status, 400);
  }
  assert.equal(limitedSupport?.status, 429);
  assert.match(limitedSupport?.headers.get('Retry-After') ?? '', /^\d+$/);
  await db.prepare('UPDATE managed_sessions SET last_used=0 WHERE token=?').run(storedToken);
  assert.equal(await adapter.getSessionAndUser!(sessionToken), null);
  const expiredSupport = await supportHistoryRoute(new Request('https://studio.fixture/api/support/requests', {
    headers: { Cookie: accountCookies },
  }));
  assert.equal(expiredSupport.status, 401);
  await db.prepare(`UPDATE managed_sessions SET last_used=floor(extract(epoch from clock_timestamp())*1000)::bigint
    WHERE token=?`).run(storedToken);
  await db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(authOwner);
  assert.equal(await adapter.getSessionAndUser!(sessionToken), null);
  await adapter.deleteSession!(sessionToken);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM sessions WHERE user_id=?').get(authOwner))?.count, 0);
});
