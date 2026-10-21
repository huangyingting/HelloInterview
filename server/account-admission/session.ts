import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { authCookieNames, loadAuthSettings } from '../auth/config';
import { prismaClient } from '../db/prisma';
import { getPublicAppOrigin } from './links';

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_LIFETIME_MS = SESSION_MAX_AGE_SECONDS * 1000;
const databaseClock = Prisma.sql`floor(extract(epoch from clock_timestamp())*1000)::bigint`;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function resolveSessionOriginAndSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { origin: string; secret: string } | null {
  const settings = loadAuthSettings(env);
  return settings ? { origin: settings.origin, secret: settings.secret } : null;
}

export function getSessionCookieNames(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const resolved = resolveSessionOriginAndSecret(env);
  const origin = resolved?.origin ?? getPublicAppOrigin(env);
  return authCookieNames({ origin });
}

export interface DirectDatabaseSession {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expires: Date;
}

export async function createDirectDatabaseSession(params: {
  userId: string;
  identityId: string;
}): Promise<DirectDatabaseSession> {
  const resolved = resolveSessionOriginAndSecret();
  if (!resolved) throw new Error('Authentication must be configured before creating a session.');
  const secret = resolved.secret;
  const sessionToken = randomBytes(32).toString('hex');
  const tokenHash = hash(sessionToken);
  const csrfToken = createHmac('sha256', secret)
    .update(`studio.csrf.v1:${sessionToken}`)
    .digest('hex');
  const csrfHash = hash(csrfToken);

  return prismaClient().$transaction(async tx => {
    const accounts = await tx.$queryRaw<
      Array<{ session_epoch: number; status: string; now: bigint | number }>
    >`
      SELECT a.session_epoch, a.status, ${databaseClock} AS now
      FROM managed_accounts a
      WHERE a.user_id = ${params.userId}
      FOR UPDATE
    `;
    const account = accounts[0];
    if (
      !account ||
      !['active', 'pending-verification', 'deletion-pending'].includes(account.status)
    ) {
      throw new Error('This Studio account is not available for authentication.');
    }
    const identities = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM managed_identities
      WHERE id = ${params.identityId} AND user_id = ${params.userId} AND available = 1
    `;
    if (!identities[0]) {
      throw new Error('The authentication identity is not available.');
    }
    const now = Number(account.now);
    const expiresMs = now + SESSION_LIFETIME_MS;
    await tx.$executeRaw`
      DELETE FROM sessions WHERE user_id = ${params.userId} AND expires <= ${now}
    `;
    await tx.$executeRaw`
      DELETE FROM sessions
      WHERE token IN (
        SELECT s.token FROM sessions s
        JOIN managed_sessions m ON m.token = s.token
        WHERE s.user_id = ${params.userId}
        ORDER BY m.created_at DESC, m.id DESC
        OFFSET 49
      )
    `;
    await tx.$executeRaw`
      INSERT INTO sessions (token, user_id, expires)
      VALUES (${tokenHash}, ${params.userId}, ${expiresMs})
    `;
    await tx.$executeRaw`
      INSERT INTO managed_sessions (token, id, identity_id, epoch, csrf_hash, authenticated_at, created_at, last_used, mfa_at)
      VALUES (${tokenHash}, ${randomUUID()}, ${params.identityId}, ${account.session_epoch}, ${csrfHash}, ${now}, ${now}, ${now}, 0)
    `;
    return {
      sessionToken,
      csrfToken,
      expires: new Date(expiresMs),
    };
  });
}

function buildCookieString(params: {
  name: string;
  value: string;
  maxAge: number;
  secure: boolean;
  expires?: Date;
}): string {
  const parts = [
    `${params.name}=${params.value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${params.maxAge}`,
  ];
  if (params.expires) {
    parts.push(`Expires=${params.expires.toUTCString()}`);
  }
  if (params.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function applySessionCookies(headers: Headers, session: DirectDatabaseSession): void {
  const names = getSessionCookieNames();
  headers.append(
    'Set-Cookie',
    buildCookieString({
      name: names.session,
      value: session.sessionToken,
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: names.secure,
      expires: session.expires,
    }),
  );
  headers.append(
    'Set-Cookie',
    buildCookieString({
      name: names.csrf,
      value: session.csrfToken,
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: names.secure,
      expires: session.expires,
    }),
  );
}
