import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from 'next-auth/adapters';
import { z } from 'zod';
import { prismaClient } from '../db/prisma';
import { currentAuthAdmission } from './request-context';

const sessionLifetime = 30 * 86400000;
const sessionIdle = 7 * 86400000;
const databaseClock = Prisma.sql`floor(extract(epoch from clock_timestamp())*1000)::bigint`;
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const providerSchema = z.enum(['google', 'facebook']);

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly contact_email: string | null;
  readonly contact_verified: number;
}

interface SessionRow extends UserRow {
  readonly token: string;
  readonly user_id: string;
  readonly expires: bigint | number;
}

function issuer(provider: string) {
  const parsed = providerSchema.parse(provider);
  return parsed === 'google' ? 'https://accounts.google.com' : 'https://www.facebook.com';
}

function adapterUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    name: row.name,
    email: row.contact_email ?? '',
    emailVerified: row.contact_verified === 1 ? new Date(0) : null,
    image: null,
  };
}

async function userById(id: string) {
  const rows = await prismaClient().$queryRaw<UserRow[]>`
    SELECT u.id,u.name,a.contact_email,a.contact_verified
    FROM users u JOIN managed_accounts a ON a.user_id=u.id
    WHERE u.id=${id}
  `;
  return rows[0] ? adapterUser(rows[0]) : null;
}

async function storedSession(sessionToken: string) {
  const parsed = tokenSchema.safeParse(sessionToken);
  if (!parsed.success) return null;
  const token = hash(parsed.data);
  const rows = await prismaClient().$queryRaw<SessionRow[]>`
    SELECT s.token,s.user_id,s.expires,u.id,u.name,a.contact_email,a.contact_verified
    FROM sessions s
    JOIN managed_sessions m ON m.token=s.token
    JOIN users u ON u.id=s.user_id
    JOIN managed_accounts a ON a.user_id=u.id
    JOIN managed_identities i ON i.id=m.identity_id AND i.user_id=u.id
    WHERE s.token=${token}
      AND s.expires>${databaseClock}
      AND m.last_used>${databaseClock}-${sessionIdle}
      AND m.epoch=a.session_epoch
      AND i.available=1
      AND m.authenticated_at>a.security_cutoff
  `;
  const row = rows[0];
  if (!row) return null;
  await prismaClient().$executeRaw`UPDATE managed_sessions SET last_used=${databaseClock} WHERE token=${token}`;
  return {
    session: {
      sessionToken: parsed.data,
      userId: row.user_id,
      expires: new Date(Number(row.expires)),
    } satisfies AdapterSession,
    user: adapterUser(row),
  };
}

export function studioAuthAdapter(): Adapter {
  return {
    async createUser() {
      throw new Error('Studio account creation must pass social admission before Auth.js creates a session.');
    },
    getUser: userById,
    async getUserByEmail() {
      return null;
    },
    async getUserByAccount(account) {
      const provider = providerSchema.parse(account.provider);
      const subject = z.string().min(1).max(512).parse(account.providerAccountId);
      const rows = await prismaClient().$queryRaw<UserRow[]>`
        SELECT u.id,u.name,a.contact_email,a.contact_verified
        FROM managed_identities i
        JOIN users u ON u.id=i.user_id
        JOIN managed_accounts a ON a.user_id=u.id
        WHERE i.issuer=${issuer(provider)} AND i.subject=${subject} AND i.available=1
      `;
      return rows[0] ? adapterUser(rows[0]) : null;
    },
    async updateUser(user) {
      const stored = await userById(user.id);
      if (!stored) throw new Error('Studio account no longer exists.');
      return stored;
    },
    async deleteUser() {
      throw new Error('Studio account deletion must use the managed privacy lifecycle.');
    },
    async linkAccount(account: AdapterAccount) {
      const provider = providerSchema.parse(account.provider);
      const subject = z.string().min(1).max(512).parse(account.providerAccountId);
      const rows = await prismaClient().$queryRaw<Array<{ user_id: string }>>`
        SELECT user_id FROM managed_identities
        WHERE issuer=${issuer(provider)} AND subject=${subject} AND available=1
      `;
      if (rows[0]?.user_id !== account.userId) throw new Error('The provider identity is not linked to this Studio account.');
      return account as AdapterAccount;
    },
    async unlinkAccount() {
      throw new Error('Studio identity removal must use the managed security lifecycle.');
    },
    async createSession(session) {
      const plaintext = tokenSchema.parse(session.sessionToken);
      const admission = currentAuthAdmission();
      if (!admission || admission.userId !== session.userId) {
        throw new Error('Auth.js session creation requires the exact admitted provider identity.');
      }
      return prismaClient().$transaction(async tx => {
        const accounts = await tx.$queryRaw<Array<{ session_epoch: number; status: string; now: bigint | number }>>`
          SELECT a.session_epoch,a.status,${databaseClock} AS now
          FROM managed_accounts a
          WHERE a.user_id=${session.userId}
          FOR UPDATE
        `;
        const account = accounts[0];
        if (!account || !['active', 'pending-verification', 'deletion-pending'].includes(account.status)) {
          throw new Error('This Studio account is not available for authentication.');
        }
        const identities = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM managed_identities
          WHERE id=${admission.identityId} AND user_id=${session.userId} AND available=1
        `;
        if (!identities[0]) throw new Error('The admitted provider identity is no longer available.');
        const now = Number(account.now);
        const token = hash(plaintext);
        await tx.$executeRaw`DELETE FROM sessions WHERE user_id=${session.userId} AND expires<=${now}`;
        await tx.$executeRaw`
          DELETE FROM sessions
          WHERE token IN (
            SELECT s.token FROM sessions s
            JOIN managed_sessions m ON m.token=s.token
            WHERE s.user_id=${session.userId}
            ORDER BY m.created_at DESC,m.id DESC
            OFFSET 49
          )
        `;
        await tx.$executeRaw`
          INSERT INTO sessions (token,user_id,expires)
          VALUES (${token},${session.userId},${now + sessionLifetime})
        `;
        await tx.$executeRaw`
          INSERT INTO managed_sessions (token,id,identity_id,epoch,csrf_hash,authenticated_at,created_at,last_used,mfa_at)
          VALUES (${token},${randomUUID()},${admission.identityId},${account.session_epoch},${hash(randomBytes(32).toString('hex'))},
            ${now},${now},${now},0)
        `;
        return { sessionToken: plaintext, userId: session.userId, expires: new Date(now + sessionLifetime) };
      });
    },
    getSessionAndUser: storedSession,
    async updateSession(session) {
      const stored = await storedSession(session.sessionToken);
      return stored?.session ?? null;
    },
    async deleteSession(sessionToken) {
      const parsed = tokenSchema.safeParse(sessionToken);
      if (!parsed.success) return null;
      const token = hash(parsed.data);
      await prismaClient().$executeRaw`DELETE FROM sessions WHERE token=${token}`;
      return null;
    },
    async createVerificationToken() {
      throw new Error('Email verification tokens are not part of Studio social authentication.');
    },
    async useVerificationToken() {
      return null;
    },
  };
}
