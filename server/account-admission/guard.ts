import { assertCsrf } from '../auth/csrf';
import { currentManagedAuthSession } from '../auth/session';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { IdentityLimits } from '../identity/limits';
import { currentStaffRoles } from '../next/staff';
import { getPublicAppOrigin } from './links';
import { resolveSessionOriginAndSecret } from './session';

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  return forwarded || realIp || '127.0.0.1';
}

export async function enforcePublicAuthRateLimit(
  request: Request,
  bucketSuffix: string,
): Promise<Response | null> {
  const resolved = resolveSessionOriginAndSecret();
  if (!resolved) return null;
  const ip = clientIp(request);
  const decision = await new IdentityLimits(prismaConnection(), resolved.secret).consume(
    'network',
    `${bucketSuffix}:${ip}`,
  );
  if (!decision.allowed) {
    return Response.json(
      {
        error: 'rate_limited',
        message: 'Too many authentication attempts. Try again shortly.',
      },
      {
        status: 429,
        headers: {
          'Cache-Control': 'private, no-store',
          'Retry-After': String(decision.retryAfter),
        },
      },
    );
  }
  return null;
}

export function assertMutationOriginOrCsrf(
  request: Request,
  session: Awaited<ReturnType<typeof currentManagedAuthSession>>,
): void {
  if (request.headers.get('X-CSRF-Token')) {
    assertCsrf(request, session);
    return;
  }
  const originHeader = request.headers.get('origin')?.trim();
  if (originHeader) {
    let requestOrigin: string | null = null;
    try {
      requestOrigin = new URL(request.url).origin;
    } catch {
      requestOrigin = null;
    }
    const allowedOrigins = new Set<string>([getPublicAppOrigin()]);
    if (requestOrigin) allowedOrigins.add(requestOrigin);
    const resolved = resolveSessionOriginAndSecret();
    if (resolved) allowedOrigins.add(resolved.origin);
    if (!allowedOrigins.has(originHeader)) {
      throw new HttpError(403, 'Cross-origin mutation request rejected.');
    }
  }
}

export async function requireInvitationAdmin(request: Request, mutation = false) {
  const session = await currentManagedAuthSession(request);
  if (!session) {
    throw new HttpError(401, 'Authentication required.');
  }
  if (session.status !== 'active' || session.user.emailVerified === null) {
    throw new HttpError(403, 'Administrator access requires an active verified account.');
  }
  if (mutation) {
    assertMutationOriginOrCsrf(request, session);
  }
  const db = prismaConnection();
  const roles = await currentStaffRoles(db, session.userId);
  if (!roles.includes('administrator')) {
    throw new HttpError(403, 'Administrator access required.');
  }
  return session;
}
