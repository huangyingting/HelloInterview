import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { levels, regions, tracks } from '../../shared/catalog';
import { communityKinds } from '../../shared/community-routes';
import { loadAuthSettings } from '../auth/config';
import { assertCsrf } from '../auth/csrf';
import { authUserFromManagedSession, currentAuthUser, currentManagedAuthSession } from '../auth/session';
import {
  CommunityReads,
  communityDiscussionResource,
  communityIdentifierSchema,
} from '../community';
import { CommunityContributions } from '../community-contributions';
import { CommunityBlocks } from '../community-blocks';
import { CommunityModeration } from '../community-moderation';
import { CommunityMutes } from '../community-mutes';
import { CommunityRestrictions } from '../community-restrictions';
import { CommunitySubmissions } from '../community-submissions';
import type { Database } from '../db/connection';
import { prismaConnection } from '../db/prisma';
import { StateRepository } from '../db/state-repository';
import { HttpError } from '../http-error';
import { IdentityLimits } from '../identity/limits';
import { assertAccountSession } from './identity';

const activeStatus = ['active'] as const;
const postSchema = z.strictObject({
  kind: z.enum(communityKinds),
  title: z.string().trim().min(5).max(200),
  body: z.string().trim().min(20).max(10000),
  company: z.string().trim().max(80).optional().default(''),
  track: z.enum([...tracks.map(track => track.id), 'code-review']),
  level: z.enum(levels),
  region: z.enum(regions),
});
const postActionSchema = z.strictObject({
  id: communityIdentifierSchema,
  action: z.enum(['vote', 'follow']),
  enabled: z.boolean(),
});
const commentSchema = z.strictObject({
  resource: z.string().max(205),
  parentId: communityIdentifierSchema.nullable().optional().default(null),
  body: z.string().trim().min(2).max(3000),
});

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

async function ownedCommunity(request: Request, mutation: boolean, limited = mutation) {
  const session = await currentManagedAuthSession(request);
  if (!session) throw new HttpError(401, 'Sign in to manage community activity.');
  if (session.status !== 'active') {
    throw new HttpError(403, 'This account is not available for community activity. Contact support.');
  }
  if (mutation) assertCsrf(request, session);
  const db = prismaConnection();
  if (limited) await enforceCommunityLimit(db, session.userId);
  const authenticated = authUserFromManagedSession(session);
  const savedUser = await db.prepare('SELECT name FROM users WHERE id=?').get(session.userId);
  if (typeof savedUser?.name !== 'string') throw new HttpError(401, 'Sign in again before managing community activity.');
  const user = { ...authenticated, name: savedUser.name };
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

export async function createCommunityPost(request: Request, input: unknown) {
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Provide a supported section, interview type, level, region, title and original details.');
  const { db, user, admit } = await ownedCommunity(request, true, false);
  const id = randomUUID();
  return db.transaction(async () => {
    await admit('participation');
    const value = parsed.data;
    await db.prepare(`INSERT INTO posts
      (id,kind,title,body,company,track,level,region,author,author_id,created_at,sample)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).run(
      id,
      value.kind,
      value.title,
      value.body,
      value.company,
      value.track,
      value.level,
      value.region,
      value.kind === 'questions' ? 'Anonymous' : user.name,
      user.id,
      new Date().toISOString(),
    );
    await new StateRepository(db).mutate(user.id, state => {
      state.recognition += 3;
      const today = new Date().toISOString().slice(0, 10);
      if (!state.activity.includes(today)) state.activity.push(today);
      state.activity = state.activity.slice(-370);
    });
    await admit('participation');
    return { id };
  });
}

export async function setCommunityPostAction(request: Request, input: unknown) {
  const parsed = postActionSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Provide a post identifier, vote or follow action, and a boolean desired state.');
  const { db, user, admit } = await ownedCommunity(request, true, false);
  const { id, action, enabled } = parsed.data;
  await db.transaction(async () => {
    await admit('participation');
    const target = await db.prepare(`SELECT p.author_id FROM posts p WHERE p.id=? AND NOT EXISTS(
      SELECT 1 FROM community_moderation_targets moderation
        WHERE moderation.target_type='post' AND moderation.target_id=p.id AND moderation.state='hidden')`).get(id);
    if (!target) throw new HttpError(404, 'Post not found.');
    await new CommunityBlocks(db).assertAllowed(user.id, z.string().parse(target.author_id));
    if (!await db.prepare(`SELECT p.id FROM posts p WHERE p.id=? AND NOT EXISTS(
      SELECT 1 FROM community_moderation_targets moderation
        WHERE moderation.target_type='post' AND moderation.target_id=p.id AND moderation.state='hidden')`).get(id)) {
      throw new HttpError(404, 'Post not found.');
    }
    const table = action === 'vote' ? 'votes' : 'follows';
    const exists = Boolean(await db.prepare(`SELECT user_id FROM ${table} WHERE post_id=? AND user_id=?`).get(id, user.id));
    if (!enabled && exists) await db.prepare(`DELETE FROM ${table} WHERE post_id=? AND user_id=?`).run(id, user.id);
    if (enabled && !exists) await db.prepare(`INSERT INTO ${table}(post_id,user_id) VALUES (?,?)`).run(id, user.id);
    await admit('participation');
  });
  return { ok: true };
}

export async function createCommunityComment(request: Request, input: unknown) {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Provide an exact discussion, optional reply and 2-3,000 characters of original text.');
  const { db, user, admit } = await ownedCommunity(request, true, false);
  const value = { ...parsed.data, resource: communityDiscussionResource(parsed.data.resource) };
  const id = randomUUID();
  return db.transaction(async () => {
    await admit('participation');
    let postAuthor: string | undefined;
    let parentAuthor: string | undefined;
    if (value.resource.startsWith('post/')) {
      const post = await db.prepare(`SELECT p.author_id FROM posts p WHERE p.id=? AND NOT EXISTS(
        SELECT 1 FROM community_moderation_targets moderation WHERE moderation.target_type='post'
          AND moderation.target_id=p.id AND moderation.state='hidden') AND NOT EXISTS(
        SELECT 1 FROM community_mutes mute WHERE mute.owner_id=? AND mute.subject_id=p.author_id AND mute.state='muted')`)
        .get(value.resource.slice(5), user.id);
      if (!post) throw new HttpError(404, 'This post is no longer available for discussion.');
      postAuthor = z.string().parse(post.author_id);
    }
    if (value.parentId) {
      const parent = await db.prepare(`SELECT comments.user_id FROM comments
        LEFT JOIN community_comment_tombstones tombstone ON tombstone.comment_id=comments.id
        LEFT JOIN community_moderation_targets moderation ON moderation.target_type='comment' AND moderation.target_id=comments.id
        WHERE comments.id=? AND comments.resource=? AND comments.user_id IS NOT NULL AND tombstone.comment_id IS NULL
          AND COALESCE(moderation.state,'visible')<>'hidden' AND NOT EXISTS(
            SELECT 1 FROM community_mutes mute WHERE mute.owner_id=? AND mute.subject_id=comments.user_id AND mute.state='muted')`)
        .get(value.parentId, value.resource, user.id);
      if (!parent) throw new HttpError(400, 'Reply must belong to an available comment in this discussion.');
      parentAuthor = z.string().parse(parent.user_id);
    }
    await new CommunityBlocks(db).assertAllowedMany(
      user.id,
      [postAuthor, parentAuthor].filter((owner): owner is string => owner !== undefined),
    );
    if (value.resource.startsWith('post/') && !await db.prepare(`SELECT p.id FROM posts p WHERE p.id=? AND NOT EXISTS(
      SELECT 1 FROM community_moderation_targets moderation WHERE moderation.target_type='post'
        AND moderation.target_id=p.id AND moderation.state='hidden') AND NOT EXISTS(
      SELECT 1 FROM community_mutes mute WHERE mute.owner_id=? AND mute.subject_id=p.author_id AND mute.state='muted')
      FOR UPDATE OF p`).get(value.resource.slice(5), user.id)) {
      throw new HttpError(404, 'This post is no longer available for discussion.');
    }
    if (value.parentId && !await db.prepare(`SELECT comments.id FROM comments
      LEFT JOIN community_comment_tombstones tombstone ON tombstone.comment_id=comments.id
      LEFT JOIN community_moderation_targets moderation ON moderation.target_type='comment' AND moderation.target_id=comments.id
      WHERE comments.id=? AND comments.resource=? AND comments.user_id IS NOT NULL AND tombstone.comment_id IS NULL
        AND COALESCE(moderation.state,'visible')<>'hidden' AND NOT EXISTS(
          SELECT 1 FROM community_mutes mute WHERE mute.owner_id=? AND mute.subject_id=comments.user_id AND mute.state='muted')`)
      .get(value.parentId, value.resource, user.id)) {
      throw new HttpError(400, 'Reply must belong to an available comment in this discussion.');
    }
    await db.prepare(`INSERT INTO comments(id,resource,user_id,author,body,created_at,parent_id)
      VALUES(?,?,?,?,?,?,?)`).run(id, value.resource, user.id, user.name, value.body, new Date().toISOString(), value.parentId);
    await admit('participation');
    return { id, comment: await new CommunityContributions(db).createdComment(id, user.id) };
  });
}

export async function createCommunityCommentSubmission(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true, false);
  return new CommunitySubmissions(db).create(user, input, () => admit('participation'));
}

export async function communityCommentSubmission(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, false, false);
  return new CommunitySubmissions(db).read(user.id, input, admit);
}

export async function communityCommentSubmissionHistory(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, false, false);
  return new CommunitySubmissions(db).history(user.id, input, admit);
}

export async function ownedCommunityPost(request: Request, input: unknown) {
  const { db, user } = await ownedCommunity(request, false, false);
  return new CommunityContributions(db).read(input, user.id);
}

export async function updateOwnedCommunityPost(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true, false);
  return new CommunityContributions(db).update(input, user.id, () => admit('participation'));
}

export async function deleteOwnedCommunityPost(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true, false);
  return new CommunityContributions(db).remove(input, user.id, admit);
}

export async function ownedCommunityComment(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, false, false);
  return new CommunityContributions(db).readComment(input, user.id, admit);
}

export async function updateOwnedCommunityComment(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true, false);
  return new CommunityContributions(db).updateComment(input, user.id, () => admit('participation'));
}

export async function deleteOwnedCommunityComment(request: Request, input: unknown) {
  const { db, user, admit } = await ownedCommunity(request, true, false);
  return new CommunityContributions(db).removeComment(input, user.id, admit);
}
