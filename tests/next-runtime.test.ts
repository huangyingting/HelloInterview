import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { GET as bootstrap } from '../app/api/bootstrap/route';
import { GET as health } from '../app/api/health/route';
import { GET as ready } from '../app/api/ready/route';
import { GET as lesson } from '../app/api/content/lessons/[track]/[id]/route';
import { GET as problem } from '../app/api/content/problems/[id]/route';
import { GET as media } from '../app/api/content/media/[course]/[file]/route';
import { GET as community } from '../app/api/community/posts/route';
import { GET as communityPost } from '../app/api/community/posts/[id]/route';
import { GET as comments } from '../app/api/comments/page/route';
import { GET as posts } from '../app/api/posts/route';
import { GET as identitySecurityRoute } from '../app/api/identity/security/route';
import { DELETE as revokeSessionRoute } from '../app/api/identity/sessions/[id]/route';
import { DELETE as removeIdentityRoute } from '../app/api/identity/methods/[id]/route';
import { POST as beginIdentityLinkRoute } from '../app/api/identity/link/route';
import { PATCH as profileRoute } from '../app/api/profile/route';
import { GET as privacyExportsRoute, POST as requestPrivacyExportRoute } from '../app/api/privacy/exports/route';
import { GET as downloadPrivacyExportRoute } from '../app/api/privacy/exports/[id]/download/route';
import { GET as privacyDeletionRoute, POST as requestPrivacyDeletionRoute } from '../app/api/privacy/deletion/route';
import { POST as cancelPrivacyDeletionRoute } from '../app/api/privacy/deletion/cancel/route';
import { POST as saveSupportRoute } from '../app/api/support/route';
import { GET as supportHistoryRoute } from '../app/api/support/requests/route';
import { postgresConnection } from '../server/db/connection';
import { migrateDatabase } from '../server/db/migrations';
import { prismaConnection } from '../server/db/prisma';
import { refreshAdmittedSession, studioAuthAdapter } from '../server/auth/adapter';
import { admitSocialIdentity } from '../server/auth/admission';
import { loadAuthSettings } from '../server/auth/config';
import { completeSocialLink } from '../server/auth/linking';
import { recordAuthAdmission, withAuthRequest } from '../server/auth/request-context';
import { closeNextPrivacyService } from '../server/next/privacy';
import { migrateJobs } from '../server/jobs';

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
  process.env.DATABASE_URL = url.href;
  for (const key of ['NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET',
    'AUTH_FACEBOOK_CLIENT_ID', 'AUTH_FACEBOOK_CLIENT_SECRET', 'AUTH_INVITED_EMAILS']) delete process.env[key];
  Object.assign(process.env, {
    NEXTAUTH_URL: 'https://studio.fixture',
    NEXTAUTH_SECRET: 'a'.repeat(64),
    AUTH_GOOGLE_CLIENT_ID: 'google-client',
    AUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    AUTH_FACEBOOK_CLIENT_ID: '123456789',
    AUTH_FACEBOOK_CLIENT_SECRET: 'facebook-secret',
    AUTH_INVITED_EMAILS: 'next-auth-owner@example.test',
  });
  t.after(async () => {
    await closeNextPrivacyService();
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
  const bootstrapResponse = await bootstrap(new Request('https://studio.fixture/api/bootstrap'));
  const bootstrapPayload = await bootstrapResponse.json();
  assert.deepEqual(healthPayload, { status: 'ok' });
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(readyPayload, { status: 'ready', mode: 'service' });
  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapPayload.user, null);
  assert.equal(bootstrapPayload.capabilities.auth.system, 'authjs');
  assert.equal(bootstrapPayload.capabilities.access.state, 'visitor');
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
  await db.prepare("UPDATE managed_accounts SET status='active' WHERE user_id=?").run(authOwner);
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
