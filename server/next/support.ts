import type { User } from '../../shared/types';
import { assertCsrf } from '../auth/csrf';
import { authUserFromManagedSession, currentManagedAuthSession } from '../auth/session';
import type { Database } from '../db/connection';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { IdentityLimits } from '../identity/limits';
import { loadAuthSettings } from '../auth/config';
import { SupportRequests, type SupportIdentityAuthority } from '../support';
import { assertAccountSession } from './identity';

const supportStatuses = ['active', 'pending-verification', 'suspended', 'deletion-pending'] as const;

async function enforceSupportLimit(db: Database, owner: string) {
  const settings = loadAuthSettings();
  if (!settings) throw new HttpError(503, 'Authentication is not configured.');
  const decision = await new IdentityLimits(db, settings.secret).consume('support-account', owner);
  if (!decision.allowed) {
    throw new HttpError(429, 'Too many support attempts. Wait for the shared 15-minute attempt window before trying again.', {
      'Retry-After': String(decision.retryAfter),
    });
  }
}

async function ownedSupport(request: Request, mutation: boolean) {
  const session = await currentManagedAuthSession(request);
  if (!session || !supportStatuses.includes(session.status as typeof supportStatuses[number])) {
    throw new HttpError(401, 'Sign in to save and revisit an owned support request.');
  }
  if (mutation) assertCsrf(request, session);
  const db = prismaConnection();
  if (mutation) await enforceSupportLimit(db, session.userId);
  const user = authUserFromManagedSession(session);
  const authority: SupportIdentityAuthority = {
    assertDatabase(candidate) {
      if (candidate !== db) throw new Error('Support and session authority must share the exact database adapter.');
    },
    assertSupport(candidate: User) {
      if (candidate !== user) throw new HttpError(401, 'Sign in again before accessing owned support.');
      return assertAccountSession(db, session, false, supportStatuses);
    },
    async assertStaff() {
      throw new HttpError(403, 'Owner support authority does not grant staff access.');
    },
    async staffRoles() {
      return [];
    },
  };
  return { support: new SupportRequests(db, authority), user };
}

export async function saveSupportRequest(request: Request, input: unknown) {
  const { support, user } = await ownedSupport(request, true);
  return support.save(user, input);
}

export async function supportHistory(request: Request, cursor: unknown) {
  const { support, user } = await ownedSupport(request, false);
  return support.history(user, cursor);
}
