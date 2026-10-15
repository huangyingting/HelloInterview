import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/connection';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { assertCsrf } from '../auth/csrf';
import type { ManagedAuthSession } from '../auth/adapter';
import { currentManagedAuthSession } from '../auth/session';
import { lockSubject } from '../identity/subject-lock';
import { IdentityLimits } from '../identity/limits';
import { authCookieNames, loadAuthSettings } from '../auth/config';

const freshness = 10 * 60000;
const idle = 7 * 86400000;
const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const allowedStatuses = ['active', 'pending-verification'] as const;
const providerSchema = z.enum(['email', 'google', 'github', 'facebook']);

export async function requireAccountSession(request: Request, statuses: readonly string[] = allowedStatuses) {
  const session = await currentManagedAuthSession(request);
  if (!session) throw new HttpError(401, 'Sign in again to manage account security.');
  if (!statuses.includes(session.status)) {
    throw new HttpError(403, 'This account is not available for product access. Contact support.');
  }
  return session;
}

export async function assertAccountSession(
  db: Database,
  session: ManagedAuthSession,
  fresh: boolean,
  statuses: readonly string[] = allowedStatuses,
) {
  await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(session.userId);
  const row = await db.prepare(`
    SELECT a.status
    FROM managed_accounts a
    JOIN sessions s ON s.user_id=a.user_id
    JOIN managed_sessions m ON m.token=s.token
    JOIN managed_identities i ON i.id=m.identity_id AND i.user_id=a.user_id
    WHERE a.user_id=? AND s.token=? AND a.session_epoch=m.epoch
      AND s.expires>${clock} AND m.last_used>${clock}-?
      AND i.available=1 AND m.authenticated_at>a.security_cutoff
      AND (?=0 OR m.authenticated_at>${clock}-?)
    FOR UPDATE OF a,s,m,i
  `).get(session.userId, session.tokenHash, idle, Number(fresh), freshness);
  if (!row || !statuses.includes(String(row.status))) {
    throw new HttpError(403, 'Your account session or verification changed. Sign in again; your saved work is unchanged.');
  }
}

async function audit(db: Database, owner: string, action: string) {
  await db.prepare('INSERT INTO identity_security_events (id,user_id,action) VALUES (?,?,?)')
    .run(randomUUID(), owner, action);
}

export async function enforceAccountLimit(owner: string) {
  const settings = loadAuthSettings();
  if (!settings) throw new HttpError(503, 'Authentication is not configured.');
  const decision = await new IdentityLimits(prismaConnection(), settings.secret).consume('account-security', owner);
  if (!decision.allowed) {
    throw new HttpError(429, 'Too many attempts. Wait for the shared 15-minute attempt window before trying again.', {
      'Retry-After': String(decision.retryAfter),
    });
  }
}

export async function identitySecurity(request: Request) {
  const session = await requireAccountSession(request);
  const db = prismaConnection();
  const now = Number((await db.prepare(`SELECT ${clock} AS now`).get())?.now);
  const identitySchema = z.object({
    id: z.string(),
    provider: providerSchema,
    email: z.string().nullable(),
    verified: z.coerce.number().int(),
    available: z.coerce.number().int(),
    created_at: z.coerce.date(),
  });
  const identities = (await db.prepare(`
    SELECT id,provider,email,verified,available,created_at
    FROM managed_identities WHERE user_id=? ORDER BY created_at,id LIMIT 20
  `).all(session.userId)).map(value => {
    const row = identitySchema.parse(value);
    return {
      id: row.id,
      provider: row.provider,
      email: row.email,
      verified: row.verified === 1,
      available: row.available === 1,
      createdAt: row.created_at.toISOString(),
      current: row.id === session.identityId,
    };
  });
  const sessions = (await db.prepare(`
    SELECT m.id,m.created_at,m.last_used,m.authenticated_at,m.mfa_at
    FROM managed_sessions m JOIN sessions s ON s.token=m.token
    WHERE s.user_id=? AND s.expires>? AND m.last_used>? AND m.epoch=?
    ORDER BY m.created_at DESC LIMIT 50
  `).all(session.userId, now, now - idle, session.epoch)).map(value => {
    const row = z.object({
      id: z.string(),
      created_at: z.coerce.number(),
      last_used: z.coerce.number(),
      authenticated_at: z.coerce.number(),
      mfa_at: z.coerce.number(),
    }).parse(value);
    return {
      id: row.id,
      createdAt: row.created_at,
      lastUsed: row.last_used,
      authenticatedAt: row.authenticated_at,
      mfa: row.mfa_at > 0,
      current: row.id === session.sessionId,
    };
  });
  const events = (await db.prepare(`
    SELECT id,action,created_at FROM identity_security_events
    WHERE user_id=? ORDER BY created_at DESC,id LIMIT 20
  `).all(session.userId)).map(value => {
    const row = z.object({ id: z.string(), action: z.string(), created_at: z.coerce.date() }).parse(value);
    return { id: row.id, action: row.action, createdAt: row.created_at.toISOString() };
  });
  const mfa = await db.prepare(`
    SELECT credential.status,credential.pending_expires,
      count(code.code_hash) FILTER (WHERE code.used_at IS NULL)::integer AS recovery_codes
    FROM managed_totp_credentials credential
    LEFT JOIN managed_mfa_recovery_codes code ON code.user_id=credential.user_id
    WHERE credential.user_id=?
    GROUP BY credential.user_id,credential.status,credential.pending_expires
  `).get(session.userId);
  return {
    identities,
    sessions,
    events,
    fresh: now - session.authenticatedAt <= freshness,
    mfa: {
      enabled: mfa?.status === 'active',
      enrollmentPending: mfa?.status === 'pending' && Number(mfa.pending_expires) > now,
      sessionVerified: now - session.mfaAt <= freshness && session.mfaAt > 0,
      recoveryCodesRemaining: mfa?.status === 'active' ? Number(mfa.recovery_codes) : 0,
    },
  };
}

export async function updateProfile(request: Request, input: unknown) {
  const current = await currentManagedAuthSession(request);
  assertCsrf(request, current);
  const session = await requireAccountSession(request);
  assertCsrf(request, session);
  const { name } = z.strictObject({ name: z.string().trim().min(2).max(60) }).parse(input);
  const db = prismaConnection();
  await db.transaction(async () => {
    await assertAccountSession(db, session, false);
    await db.prepare('UPDATE users SET name=? WHERE id=?').run(name, session.userId);
  });
  return { id: session.userId, name, email: session.user.email, demo: false,
    identity: { status: session.status, verified: session.user.emailVerified !== null } };
}

export async function revokeSession(request: Request, id: string) {
  const session = await requireAccountSession(request);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const parsed = z.string().min(1).max(200).parse(id);
  const db = prismaConnection();
  await db.transaction(async () => {
    await assertAccountSession(db, session, true);
    const changed = await db.prepare(`
      DELETE FROM sessions s USING managed_sessions m
      WHERE m.token=s.token AND m.id=? AND s.user_id=?
    `).run(parsed, session.userId);
    if (!changed) throw new HttpError(404, 'Session not found.');
    await audit(db, session.userId, 'session-revoked');
  });
  return { ok: true };
}

export async function revokeOtherSessions(request: Request) {
  const session = await requireAccountSession(request);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const db = prismaConnection();
  await db.transaction(async () => {
    await assertAccountSession(db, session, true);
    await db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(session.userId, session.tokenHash);
    await audit(db, session.userId, 'other-sessions-revoked');
  });
  return { ok: true };
}

export async function removeIdentity(request: Request, id: string) {
  const session = await requireAccountSession(request);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const parsed = z.string().min(1).max(200).parse(id);
  const db = prismaConnection();
  await db.transaction(async () => {
    const method = await db.prepare(`
      SELECT issuer,subject FROM managed_identities WHERE id=? AND user_id=?
    `).get(parsed, session.userId);
    if (!method) throw new HttpError(404, 'Sign-in method not found.');
    const issuer = z.string().min(1).max(512).parse(method.issuer);
    const subject = z.string().min(1).max(512).parse(method.subject);
    await lockSubject(db, issuer, subject);
    await assertAccountSession(db, session, true);
    const identities = await db.prepare(`
      SELECT id,verified,email,available FROM managed_identities WHERE user_id=?
    `).all(session.userId);
    if (!identities.some(identity => identity.id === parsed)) throw new HttpError(404, 'Sign-in method not found.');
    if (parsed === session.identityId ||
      !identities.some(identity => identity.id !== parsed && identity.verified === 1 && identity.available === 1)) {
      throw new HttpError(409, 'Keep another available verified sign-in method and confirm with it before removing this one.');
    }
    const account = await db.prepare('SELECT contact_identity_id FROM managed_accounts WHERE user_id=?')
      .get(session.userId);
    if (account?.contact_identity_id === parsed) {
      const current = identities.find(identity => identity.id === session.identityId);
      if (current?.verified !== 1 || typeof current.email !== 'string') {
        throw new HttpError(409, 'Confirm with another verified contact method before removing your current contact source.');
      }
      await db.prepare(`
        UPDATE managed_accounts
        SET contact_identity_id=?,contact_email=?,contact_verified=1,session_epoch=session_epoch+1
        WHERE user_id=?
      `).run(session.identityId, current.email, session.userId);
      await db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(session.userId, session.tokenHash);
      await db.prepare('UPDATE managed_sessions SET epoch=epoch+1 WHERE token=?').run(session.tokenHash);
    }
    await db.prepare(`
      DELETE FROM sessions s USING managed_sessions m
      WHERE m.token=s.token AND m.identity_id=? AND s.user_id=?
    `).run(parsed, session.userId);
    await db.prepare('DELETE FROM managed_identities WHERE id=? AND user_id=?').run(parsed, session.userId);
    await db.prepare(`
      INSERT INTO identity_security_events (id,user_id,action,identity_id) VALUES (?,?,?,?)
    `).run(randomUUID(), session.userId, 'identity-unlinked', parsed);
  });
  return { ok: true };
}

export async function beginIdentityLink(request: Request, input: unknown) {
  const session = await requireAccountSession(request);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const { provider } = z.strictObject({ provider: z.enum(['google', 'facebook']) }).parse(input);
  const settings = loadAuthSettings();
  if (!settings) throw new HttpError(503, 'Authentication is not configured.');
  const db = prismaConnection();
  const token = randomBytes(32).toString('hex');
  await db.transaction(async () => {
    await assertAccountSession(db, session, true);
    await db.prepare(`DELETE FROM auth_transactions WHERE expires<=${clock}`).run();
    const count = await db.prepare(`
      SELECT count(*)::integer AS count FROM auth_transactions
      WHERE user_id=? AND purpose='link'
    `).get(session.userId);
    if (Number(count?.count) >= 8) {
      throw new HttpError(429, 'Finish an existing provider-link attempt or wait ten minutes before starting another.');
    }
    const now = Number((await db.prepare(`SELECT ${clock} AS now`).get())?.now);
    await db.prepare(`
      INSERT INTO auth_transactions
        (state_hash,binding_hash,verifier,nonce,provider,purpose,user_id,session_hash,legacy_credential_hash,
          return_to,expires,created_at,requires_fresh)
      VALUES (?,?,?,?,?,'link',?,?,NULL,'/account',?,?,1)
    `).run(createHash('sha256').update(token).digest('hex'), session.tokenHash, 'authjs-link',
      randomBytes(32).toString('hex'), provider, session.userId, session.tokenHash, now + freshness, now);
  });
  const names = authCookieNames(settings);
  const cookie = `${names.action}=${token}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${names.secure ? '; Secure' : ''}`;
  return {
    url: `/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent('/account')}`,
    cookie,
  };
}
