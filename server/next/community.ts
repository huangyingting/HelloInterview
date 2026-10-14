import { loadAuthSettings } from '../auth/config';
import { assertCsrf } from '../auth/csrf';
import { authUserFromManagedSession, currentAuthUser, currentManagedAuthSession } from '../auth/session';
import { CommunityReads, communityDiscussionResource } from '../community';
import { CommunityContributions } from '../community-contributions';
import { CommunityBlocks } from '../community-blocks';
import { CommunityModeration } from '../community-moderation';
import { CommunityMutes } from '../community-mutes';
import { CommunityRestrictions } from '../community-restrictions';
import type { Database } from '../db/connection';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { IdentityLimits } from '../identity/limits';
import { assertAccountSession } from './identity';

const activeStatus = ['active'] as const;

async function viewer(request: Request) {
  return (await currentAuthUser(request))?.id ?? null;
}

export async function legacyPosts(request: Request, kind: unknown) {
  return new CommunityReads(prismaConnection()).legacy(kind, await viewer(request));
}

export async function communityFeed(request: Request, input: unknown) {
  return new CommunityReads(prismaConnection()).feed(input, await viewer(request));
}

export async function communityDetail(request: Request, input: unknown) {
  return new CommunityReads(prismaConnection()).addressedDetail(input, await viewer(request), false);
}

export async function communityPathDetail(request: Request, id: string, input: unknown) {
  return new CommunityReads(prismaConnection()).detail(id, input, await viewer(request), false);
}

export async function discussionComments(request: Request, resource: unknown) {
  return new CommunityContributions(prismaConnection()).comments(communityDiscussionResource(resource), await viewer(request));
}

export async function discussionPage(request: Request, input: unknown) {
  return new CommunityContributions(prismaConnection()).commentPage(input, await viewer(request));
}

async function enforceCommunityLimit(db: Database, owner: string) {
  const settings = loadAuthSettings();
  if (!settings) throw new HttpError(503, 'Authentication is not configured.');
  const decision = await new IdentityLimits(db, settings.secret).consume('community-account', owner);
  if (!decision.allowed) {
    throw new HttpError(429, 'Too many community attempts. Wait for the shared 15-minute attempt window before trying again.', {
      'Retry-After': String(decision.retryAfter),
    });
  }
}

async function ownedCommunity(request: Request, mutation: boolean) {
  const session = await currentManagedAuthSession(request);
  if (!session) throw new HttpError(401, 'Sign in to manage community activity.');
  if (session.status !== 'active') {
    throw new HttpError(403, 'This account is not available for community activity. Contact support.');
  }
  if (mutation) assertCsrf(request, session);
  const db = prismaConnection();
  if (mutation) await enforceCommunityLimit(db, session.userId);
  const user = authUserFromManagedSession(session);
  const admit = async (scope?: 'participation' | 'reporting') => {
    await assertAccountSession(db, session, false, activeStatus);
    if (scope) await new CommunityRestrictions(db, null).assertAllowed(user.id, scope);
  };
  return { db, user, admit };
}

export async function saveCommunityReport(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true);
  return new CommunityModeration(db, null).report(user, input, () => admit('reporting'));
}

export async function communityReportHistory(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, false);
  return new CommunityModeration(db, null).reportHistory(user, input, admit);
}

export async function saveCommunityAppeal(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true);
  return new CommunityModeration(db, null).appeal(user, input, admit);
}

export async function communityAppealHistory(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, false);
  return new CommunityModeration(db, null).appealHistory(user, input, admit);
}

export async function setCommunityMute(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true);
  return new CommunityMutes(db).set(user, input, admit);
}

export async function communityMuteHistory(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, false);
  return new CommunityMutes(db).history(user, input, admit);
}

export async function setCommunityBlock(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true);
  return new CommunityBlocks(db).set(user, input, admit);
}

export async function communityBlockHistory(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, false);
  return new CommunityBlocks(db).history(user, input, admit);
}

export async function communityRestrictionStatus(request: Request) {
  const { db, user, admit } = await ownedCommunity(request, false);
  return db.transaction(async () => {
    await admit();
    const status = await new CommunityRestrictions(db, null).status(user);
    await admit();
    return status;
  });
}

export async function saveCommunityRestrictionAppeal(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true);
  return new CommunityRestrictions(db, null).appeal(user, input, admit);
}

export async function communityRestrictionAppealHistory(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, false);
  return new CommunityRestrictions(db, null).appealHistory(user, input, admit);
}
