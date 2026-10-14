import { createHash, randomUUID } from 'node:crypto';
import type { Account, Profile } from 'next-auth';
import { z } from 'zod';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { lockSubject } from '../identity/lifecycle';
import { socialProof } from './admission';
import { authCookieNames, type AuthSettings } from './config';
import { authRequestCookie, type AuthAdmission } from './request-context';

const freshness = 10 * 60000;
const idle = 7 * 86400000;
const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const tokenPattern = /^[a-f0-9]{64}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const actionSchema = z.object({
  provider: z.enum(['google', 'facebook']),
  user_id: z.string(),
  session_hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function completeSocialLink(settings: AuthSettings, account: Account, profile: Profile): Promise<AuthAdmission | null> {
  const names = authCookieNames(settings);
  const actionToken = authRequestCookie(names.action);
  if (!actionToken) return null;
  if (!tokenPattern.test(actionToken)) throw new HttpError(403, 'The provider-link action is invalid. Start again from Account.');
  const sessionToken = authRequestCookie(names.session);
  if (!sessionToken || !tokenPattern.test(sessionToken)) {
    throw new HttpError(403, 'Your account session changed. Start provider linking again.');
  }
  const proof = socialProof(account, profile);
  const db = prismaConnection();
  const action = actionSchema.safeParse(await db.prepare(`
    DELETE FROM auth_transactions
    WHERE state_hash=? AND purpose='link' AND expires>${clock}
    RETURNING provider,user_id,session_hash
  `).get(hash(actionToken)));
  if (!action.success || action.data.provider !== proof.provider ||
    action.data.session_hash !== hash(sessionToken)) {
    throw new HttpError(403, 'The provider-link action expired or no longer matches this account session.');
  }
  return db.transaction(async () => {
    await lockSubject(db, proof.issuer, proof.subject);
    await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(action.data.user_id);
    const current = await db.prepare(`
      SELECT a.status,a.contact_verified
      FROM managed_accounts a
      JOIN sessions s ON s.user_id=a.user_id
      JOIN managed_sessions m ON m.token=s.token
      JOIN managed_identities i ON i.id=m.identity_id AND i.user_id=a.user_id
      WHERE a.user_id=? AND s.token=? AND a.session_epoch=m.epoch
        AND s.expires>${clock} AND m.last_used>${clock}-?
        AND m.authenticated_at>${clock}-?
        AND i.available=1 AND m.authenticated_at>a.security_cutoff
      FOR UPDATE OF a,s,m,i
    `).get(action.data.user_id, action.data.session_hash, idle, freshness);
    if (!current || !['active', 'pending-verification'].includes(String(current.status))) {
      throw new HttpError(403, 'Your account session or verification changed. Start provider linking again.');
    }
    if (proof.provider === 'google' && (!proof.verifiedEmail || !proof.email)) {
      throw new HttpError(403, 'Google must provide a verified contact email before it can be linked.');
    }
    const existing = await db.prepare(`
      SELECT id,user_id FROM managed_identities WHERE issuer=? AND subject=? FOR UPDATE
    `).get(proof.issuer, proof.subject);
    if (existing && existing.user_id !== action.data.user_id) {
      throw new HttpError(409, 'This sign-in method already belongs to another Studio account. No accounts were merged.');
    }
    const identityId = existing ? String(existing.id) : randomUUID();
    if (!existing) {
      const count = await db.prepare('SELECT count(*)::integer AS count FROM managed_identities WHERE user_id=?')
        .get(action.data.user_id);
      if (Number(count?.count) >= 10) {
        throw new HttpError(409, 'This account has reached its sign-in method limit. Remove an unused method first.');
      }
      await db.prepare(`
        INSERT INTO managed_identities (id,user_id,issuer,subject,provider,email,verified)
        VALUES (?,?,?,?,?,?,?)
      `).run(identityId, action.data.user_id, proof.issuer, proof.subject, proof.provider, proof.email,
        Number(proof.verifiedEmail));
    } else {
      await db.prepare('UPDATE managed_identities SET email=?,verified=?,available=1 WHERE id=?')
        .run(proof.email, Number(proof.verifiedEmail), identityId);
    }
    if (current.contact_verified !== 1 && proof.verifiedEmail && proof.email) {
      await db.prepare(`
        UPDATE managed_accounts
        SET status='active',contact_email=?,contact_verified=1,contact_identity_id=?,session_epoch=session_epoch+1
        WHERE user_id=?
      `).run(proof.email, identityId, action.data.user_id);
      await db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?')
        .run(action.data.user_id, action.data.session_hash);
      await db.prepare('UPDATE managed_sessions SET epoch=epoch+1 WHERE token=?')
        .run(action.data.session_hash);
    }
    await db.prepare(`
      INSERT INTO identity_security_events (id,user_id,action,identity_id) VALUES (?,?,?,?)
    `).run(randomUUID(), action.data.user_id, 'identity-linked', identityId);
    return { userId: action.data.user_id, identityId };
  });
}

export function clearSocialLinkCookie(settings: AuthSettings) {
  const names = authCookieNames(settings);
  return `${names.action}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${names.secure ? '; Secure' : ''}`;
}
