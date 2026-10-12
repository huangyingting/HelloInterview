import { z } from 'zod';
import type { Comment, OwnedCommunityComment, OwnedCommunityPost } from '../shared/types';
import type { Database } from './db/connection';
import { CommunityReads, communityIdentifier, communityIdentifierSchema } from './community';
import { HttpError } from './http-error';

const revision = z.number().int().min(0).max(2147483647);
const identity = z.strictObject({ id: communityIdentifierSchema, revision });
const edit = identity.extend({
  title: z.string().max(200).trim().min(5).refine(value => !value.includes('\0')),
  body: z.string().max(10000).trim().min(20).refine(value => !value.includes('\0')),
});
const commentEdit = identity.extend({ body: z.string().max(3000).trim().min(2).refine(value => !value.includes('\0')) });
const commentProjection = 'id,resource,author,body,created_at AS "createdAt",parent_id AS "parentId"';
const commentDto = z.strictObject({
  id: z.string(), resource: z.string(), author: z.string(), body: z.string(),
  createdAt: z.string(), parentId: z.string().nullable(), isMine: z.union([z.literal(0),z.literal(1)]).transform(value => value === 1),
});

export class CommunityContributions {
  private readonly reads: CommunityReads;
  constructor(private readonly db: Database) { this.reads = new CommunityReads(db); }
  private async snapshot(id: string, owner: string): Promise<OwnedCommunityPost> {
    const row = await this.db.prepare(`SELECT kind FROM posts WHERE id=? AND author_id=? AND sample=0
      ${this.db.dialect === 'postgres' ? 'FOR UPDATE' : ''}`).get(id, owner);
    if (!row) throw new HttpError(404, 'This original post is unavailable or is not editable by this account.');
    const version = await this.db.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(id);
    return { post: await this.reads.detail(id, { kind: row.kind }, owner), revision: revision.parse(version?.revision) };
  }
  async read(input: unknown, owner: string) {
    const query = z.strictObject({ id: z.string() }).safeParse(input);
    if (!query.success) throw new HttpError(400, 'Provide only one exact post identifier.');
    const id = communityIdentifier(query.data.id);
    return this.db.transaction(() => this.snapshot(id, owner));
  }
  private async admitted(owner: string, admit: () => Promise<void>) {
    if (!await this.db.prepare(`SELECT id FROM users WHERE id=?${this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''}`).get(owner))
      throw new HttpError(401, 'Sign in to manage your original contribution.');
    await admit();
  }
  private assertRevision(saved: { revision: number }, expected: number, kind = 'post') {
    if (saved.revision !== expected) throw new HttpError(409, `This ${kind} changed since you opened it. The requested change was not applied. Load the saved version before deciding what to change.`);
  }
  async comments(resource: string, owner: string | null): Promise<Comment[]> {
    const rows = await this.db.prepare(`SELECT ${commentProjection},CASE WHEN user_id=? THEN 1 ELSE 0 END AS "isMine"
      FROM comments WHERE resource=? ORDER BY created_at ASC LIMIT 500`).all(owner,resource);
    return rows.map(row => commentDto.parse(row));
  }
  private async commentSnapshot(id: string, owner: string): Promise<OwnedCommunityComment> {
    const location = await this.db.prepare('SELECT resource FROM comments WHERE id=? AND user_id=?').get(id,owner);
    if (!location) throw new HttpError(404, 'This comment is unavailable or is not editable by this account.');
    const resource = z.string().parse(location.resource);
    if (resource.startsWith('post/')) {
      const postId = communityIdentifierSchema.parse(resource.slice(5));
      if (!await this.db.prepare(`SELECT id FROM posts WHERE id=?${this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''}`).get(postId))
        throw new HttpError(404, 'This discussion is no longer available.');
    }
    const row = await this.db.prepare(`SELECT ${commentProjection},1 AS "isMine" FROM comments WHERE id=? AND user_id=?
      ${this.db.dialect === 'postgres' ? 'FOR UPDATE' : ''}`).get(id,owner);
    if (!row) throw new HttpError(404, 'This comment is no longer editable.');
    const comment = commentDto.parse(row);
    if (comment.resource !== resource) throw new HttpError(409, 'This comment changed discussion while it was opening. Check the saved version before editing.');
    const version = await this.db.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(id);
    return { comment, revision: revision.parse(version?.revision) };
  }
  async readComment(input: unknown, owner: string, admit: () => Promise<void>) {
    const query = z.strictObject({ id: communityIdentifierSchema }).safeParse(input);
    if (!query.success) throw new HttpError(400, 'Provide only one exact bounded comment identifier.');
    return this.db.transaction(async () => {
      await this.admitted(owner,admit);
      return this.commentSnapshot(query.data.id,owner);
    });
  }
  async updateComment(input: unknown, owner: string, admit: () => Promise<void>) {
    const parsed = commentEdit.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'Provide an exact comment identifier, saved revision and 2-3,000 characters of original text.');
    const draft = parsed.data;
    return this.db.transaction(async () => {
      await this.admitted(owner,admit);
      const saved = await this.commentSnapshot(draft.id,owner); this.assertRevision(saved,draft.revision,'comment');
      if (saved.revision === 2147483647) throw new HttpError(409, 'This comment has reached its revision limit and cannot be edited again.');
      const changed = await this.db.prepare('UPDATE comments SET body=? WHERE id=? AND user_id=?').run(draft.body,draft.id,owner);
      if (changed !== 1) throw new HttpError(404, 'This comment is no longer editable.');
      return this.commentSnapshot(draft.id,owner);
    });
  }
  async update(input: unknown, owner: string, admit: () => Promise<void>) {
    const parsed = edit.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'Provide an exact post identifier, saved revision, a 5-200 character title and 20-10,000 characters of original text.');
    const draft = parsed.data;
    return this.db.transaction(async () => {
      await this.admitted(owner, admit);
      const saved = await this.snapshot(draft.id, owner); this.assertRevision(saved, draft.revision);
      if (saved.revision === 2147483647) throw new HttpError(409, 'This post has reached its revision limit and cannot be edited again.');
      const changed = await this.db.prepare('UPDATE posts SET title=?,body=? WHERE id=? AND author_id=? AND sample=0').run(draft.title, draft.body, draft.id, owner);
      if (changed !== 1) throw new HttpError(404, 'This original post is no longer editable.');
      return this.snapshot(draft.id, owner);
    });
  }
  async remove(input: unknown, owner: string, admit: () => Promise<void>) {
    const parsed = identity.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'Provide an exact post identifier and saved revision.');
    return this.db.transaction(async () => {
      await this.admitted(owner, admit);
      const saved = await this.snapshot(parsed.data.id, owner); this.assertRevision(saved, parsed.data.revision);
      const resource = `post/${parsed.data.id}`;
      await this.db.prepare('UPDATE comments SET parent_id=NULL WHERE resource<>? AND parent_id IN (SELECT id FROM comments WHERE resource=?)').run(resource, resource);
      await this.db.prepare('DELETE FROM comments WHERE resource=?').run(resource);
      const changed = await this.db.prepare('DELETE FROM posts WHERE id=? AND author_id=? AND sample=0').run(parsed.data.id, owner);
      if (changed !== 1) throw new HttpError(404, 'This original post is no longer editable.');
      return { deleted: true };
    });
  }
}
