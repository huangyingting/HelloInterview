import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCsrf } from '../auth/csrf';
import { loadAuthSettings } from '../auth/config';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  recoveryCodeHash,
  verifyTotp,
} from '../auth/totp';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import {
  assertAccountSession,
  enforceAccountLimit,
  requireAccountSession,
} from './identity';

const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const freshness = 10 * 60000;
const enrollmentLifetime = 10 * 60000;
const codeSchema = z.string().regex(/^\d{6}$/);
const recoverySchema = z.string().trim().min(20).max(23);

function settings() {
  const value = loadAuthSettings();
  if (!value) throw new HttpError(503, 'Authentication is not configured.');
  return value;
}

async function audit(owner: string, action: string) {
  await prismaConnection().prepare(
    'INSERT INTO identity_security_events (id,user_id,action) VALUES (?,?,?)',
  ).run(randomUUID(), owner, action);
}

async function replaceRecoveryCodes(owner: string, codes: readonly string[], now: number) {
  const auth = settings();
  const db = prismaConnection();
  await db.prepare('DELETE FROM managed_mfa_recovery_codes WHERE user_id=?').run(owner);
  for (const code of codes) {
    const hash = recoveryCodeHash(auth.secret, owner, code);
    if (!hash) throw new Error('Generated recovery code is invalid.');
    await db.prepare(`
      INSERT INTO managed_mfa_recovery_codes (user_id,code_hash,created_at) VALUES (?,?,?)
    `).run(owner, hash, now);
  }
}

async function assertFreshMfa(owner: string, token: string) {
  const row = await prismaConnection().prepare(`
    SELECT m.token FROM sessions s JOIN managed_sessions m ON m.token=s.token
    WHERE s.user_id=? AND s.token=? AND m.mfa_at>${clock}-?
    FOR UPDATE OF s,m
  `).get(owner, token, freshness);
  if (!row) throw new HttpError(403, 'Enter a current authenticator or recovery code before changing MFA settings.');
}

export async function beginTotpEnrollment(request: Request) {
  const session = await requireAccountSession(request, ['active']);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const auth = settings();
  const secret = generateTotpSecret();
  const db = prismaConnection();
  let expiresAt = 0;
  await db.transaction(async () => {
    await assertAccountSession(db, session, true, ['active']);
    const existing = await db.prepare(`
      SELECT status FROM managed_totp_credentials WHERE user_id=? FOR UPDATE
    `).get(session.userId);
    if (existing?.status === 'active') {
      throw new HttpError(409, 'Authenticator MFA is already enabled. Disable it before enrolling a replacement.');
    }
    const now = Number((await db.prepare(`SELECT ${clock} AS now`).get())?.now);
    expiresAt = now + enrollmentLifetime;
    await db.prepare(`
      INSERT INTO managed_totp_credentials
        (user_id,secret_ciphertext,status,pending_expires,last_used_step,created_at,verified_at,updated_at)
      VALUES (?,?,'pending',?,-1,?,NULL,?)
      ON CONFLICT (user_id) DO UPDATE SET
        secret_ciphertext=excluded.secret_ciphertext,status='pending',
        pending_expires=excluded.pending_expires,last_used_step=-1,
        created_at=excluded.created_at,verified_at=NULL,updated_at=excluded.updated_at
      WHERE managed_totp_credentials.status='pending'
    `).run(session.userId, encryptTotpSecret(secret, auth.mfaEncryptionKey, session.userId),
      expiresAt, now, now);
    await audit(session.userId, 'mfa-enrollment-started');
  });
  const label = session.user.email || session.userId;
  const uri = `otpauth://totp/${encodeURIComponent(`Interview Studio:${label}`)}?secret=${secret}` +
    `&issuer=${encodeURIComponent('Interview Studio')}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri, expiresAt };
}

export async function verifyTotpEnrollment(request: Request, input: unknown) {
  const session = await requireAccountSession(request, ['active']);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const { code } = z.strictObject({ code: codeSchema }).parse(input);
  const auth = settings();
  const db = prismaConnection();
  const recoveryCodes = generateRecoveryCodes();
  await db.transaction(async () => {
    await assertAccountSession(db, session, true, ['active']);
    const credential = await db.prepare(`
      SELECT secret_ciphertext,pending_expires,last_used_step
      FROM managed_totp_credentials
      WHERE user_id=? AND status='pending'
      FOR UPDATE
    `).get(session.userId);
    const now = Number((await db.prepare(`SELECT ${clock} AS now`).get())?.now);
    if (!credential || Number(credential.pending_expires) <= now) {
      throw new HttpError(409, 'This authenticator enrollment expired. Start a new enrollment.');
    }
    const secret = decryptTotpSecret(String(credential.secret_ciphertext), auth.mfaEncryptionKey, session.userId);
    const step = verifyTotp(secret, code, now, Number(credential.last_used_step));
    if (step === null) throw new HttpError(403, 'The authenticator code is invalid or has already been used.');
    const changed = await db.prepare(`
      UPDATE managed_totp_credentials
      SET status='active',pending_expires=NULL,last_used_step=?,verified_at=?,updated_at=?
      WHERE user_id=? AND status='pending'
    `).run(step, now, now, session.userId);
    if (!changed) throw new HttpError(409, 'Authenticator enrollment changed. Start again.');
    await replaceRecoveryCodes(session.userId, recoveryCodes, now);
    await db.prepare('UPDATE managed_sessions SET mfa_at=? WHERE token=?').run(now, session.tokenHash);
    await audit(session.userId, 'mfa-enabled');
  });
  return { recoveryCodes };
}

export async function completeMfaChallenge(request: Request, input: unknown) {
  const session = await requireAccountSession(request, ['active']);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const parsed = z.union([
    z.strictObject({ code: codeSchema }),
    z.strictObject({ recoveryCode: recoverySchema }),
  ]).parse(input);
  const auth = settings();
  const db = prismaConnection();
  let recovery = false;
  await db.transaction(async () => {
    await assertAccountSession(db, session, false, ['active']);
    const credential = await db.prepare(`
      SELECT secret_ciphertext,last_used_step FROM managed_totp_credentials
      WHERE user_id=? AND status='active' FOR UPDATE
    `).get(session.userId);
    if (!credential) throw new HttpError(409, 'Authenticator MFA is not enabled for this account.');
    const now = Number((await db.prepare(`SELECT ${clock} AS now`).get())?.now);
    if ('code' in parsed) {
      const secret = decryptTotpSecret(String(credential.secret_ciphertext), auth.mfaEncryptionKey, session.userId);
      const step = verifyTotp(secret, parsed.code, now, Number(credential.last_used_step));
      if (step === null) throw new HttpError(403, 'The authenticator or recovery code is invalid or has already been used.');
      await db.prepare(`
        UPDATE managed_totp_credentials SET last_used_step=?,updated_at=?
        WHERE user_id=? AND status='active'
      `).run(step, now, session.userId);
    } else {
      const hash = recoveryCodeHash(auth.secret, session.userId, parsed.recoveryCode);
      const changed = hash ? await db.prepare(`
        UPDATE managed_mfa_recovery_codes SET used_at=?
        WHERE user_id=? AND code_hash=? AND used_at IS NULL
      `).run(now, session.userId, hash) : 0;
      if (!changed) throw new HttpError(403, 'The authenticator or recovery code is invalid or has already been used.');
      recovery = true;
    }
    await db.prepare('UPDATE managed_sessions SET mfa_at=? WHERE token=?').run(now, session.tokenHash);
    await audit(session.userId, recovery ? 'mfa-recovery-code-used' : 'mfa-challenge-completed');
  });
  return { verified: true, recovery };
}

export async function regenerateRecoveryCodes(request: Request) {
  const session = await requireAccountSession(request, ['active']);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const db = prismaConnection();
  const recoveryCodes = generateRecoveryCodes();
  await db.transaction(async () => {
    await assertAccountSession(db, session, true, ['active']);
    await assertFreshMfa(session.userId, session.tokenHash);
    const credential = await db.prepare(`
      SELECT user_id FROM managed_totp_credentials WHERE user_id=? AND status='active' FOR UPDATE
    `).get(session.userId);
    if (!credential) throw new HttpError(409, 'Authenticator MFA is not enabled for this account.');
    const now = Number((await db.prepare(`SELECT ${clock} AS now`).get())?.now);
    await replaceRecoveryCodes(session.userId, recoveryCodes, now);
    await audit(session.userId, 'mfa-recovery-codes-regenerated');
  });
  return { recoveryCodes };
}

export async function disableTotp(request: Request) {
  const session = await requireAccountSession(request, ['active']);
  assertCsrf(request, session);
  await enforceAccountLimit(session.userId);
  const db = prismaConnection();
  await db.transaction(async () => {
    await assertAccountSession(db, session, true, ['active']);
    await assertFreshMfa(session.userId, session.tokenHash);
    const changed = await db.prepare(`
      DELETE FROM managed_totp_credentials WHERE user_id=? AND status='active'
    `).run(session.userId);
    if (!changed) throw new HttpError(409, 'Authenticator MFA is not enabled for this account.');
    await db.prepare('DELETE FROM managed_mfa_recovery_codes WHERE user_id=?').run(session.userId);
    await db.prepare(`
      UPDATE managed_sessions SET mfa_at=0
      WHERE token IN (SELECT token FROM sessions WHERE user_id=?)
    `).run(session.userId);
    await audit(session.userId, 'mfa-disabled');
  });
  return { ok: true };
}
