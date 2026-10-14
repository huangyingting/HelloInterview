import { currentAuthUser } from '../auth/session';
import { CommunityReads, communityDiscussionResource } from '../community';
import { CommunityContributions } from '../community-contributions';
import { prismaConnection } from '../db/prisma';

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
