import { currentAuthUser } from '../auth/session';
import { CommunityReads, communityDiscussionResource } from '../community';
import { CommunityContributions } from '../community-contributions';
import { prismaConnection } from '../db/prisma';

async function viewer() {
  return (await currentAuthUser())?.id ?? null;
}

export async function legacyPosts(kind: unknown) {
  return new CommunityReads(prismaConnection()).legacy(kind, await viewer());
}

export async function communityFeed(input: unknown) {
  return new CommunityReads(prismaConnection()).feed(input, await viewer());
}

export async function communityDetail(input: unknown) {
  return new CommunityReads(prismaConnection()).addressedDetail(input, await viewer(), false);
}

export async function communityPathDetail(id: string, input: unknown) {
  return new CommunityReads(prismaConnection()).detail(id, input, await viewer(), false);
}

export async function discussionComments(resource: unknown) {
  return new CommunityContributions(prismaConnection()).comments(communityDiscussionResource(resource), await viewer());
}

export async function discussionPage(input: unknown) {
  return new CommunityContributions(prismaConnection()).commentPage(input, await viewer());
}
