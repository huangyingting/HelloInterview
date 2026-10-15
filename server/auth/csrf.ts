import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { authCookieNames } from './config';
import { resolveSessionOriginAndSecret } from '../account-admission/session';
import { prismaClient } from '../db/prisma';
import { HttpError } from '../http-error';
import type { ManagedAuthSession } from './adapter';

const tokenPattern = /^[a-f0-9]{64}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function exactCookie(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '').split(';')
    .map(value => value.trim())
    .filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return tokenPattern.test(value) ? value : null;
}

function equal(first: string, second: string) {
  const left = Buffer.from(first), right = Buffer.from(second);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookie(name: string, value: string, secure: boolean) {
  return `${name}=${value}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export async function issueCsrf(request: Request, session: ManagedAuthSession | null) {
  const settings = resolveSessionOriginAndSecret();
  if (!settings) throw new HttpError(503, 'Authentication is not configured.');
  const names = authCookieNames(settings);
  const existing = exactCookie(request, names.csrf);
  if (existing && (!session || equal(hash(existing), session.csrfHash))) return { token: existing, cookie: null };
  const token = session
    ? createHmac('sha256', settings.secret).update(`studio.csrf.v1:${session.sessionToken}`).digest('hex')
    : randomBytes(32).toString('hex');
  if (session) {
    await prismaClient().$executeRaw`
      UPDATE managed_sessions SET csrf_hash=${hash(token)} WHERE token=${session.tokenHash}
    `;
  }
  return { token, cookie: cookie(names.csrf, token, names.secure) };
}

export function assertCsrf(request: Request, session: ManagedAuthSession | null) {
  const settings = resolveSessionOriginAndSecret();
  if (!settings) throw new HttpError(503, 'Authentication is not configured.');
  const submitted = request.headers.get('X-CSRF-Token');
  const expected = exactCookie(request, authCookieNames(settings).csrf);
  if (!submitted || !tokenPattern.test(submitted) || !expected || !equal(submitted, expected)) {
    throw new HttpError(403, 'Your security token changed or is missing. Refresh this page before trying again.');
  }
  if (session && !equal(hash(submitted), session.csrfHash)) {
    throw new HttpError(403, 'Your security token belongs to a different session. Refresh this page.');
  }
}
