import { z } from 'zod';
import type { Comment, CommunityCommentDeletion, CommunityCommentPage, OwnedCommunityComment, OwnedCommunityPost } from '../shared/types';
import type { Database } from './db/connection';
import { CommunityReads, communityDiscussionResource, communityIdentifier, communityIdentifierSchema, communityPageCursor } from './community';
import { HttpError } from './http-error';
import { digest, encodePayload } from './jobs/schema';

const revision = z.number().int().min(0).max(2147483647);
const identity = z.strictObject({ id: communityIdentifierSchema, revision });
const edit = identity.extend({
  title: z.string().max(200).trim().min(5).refine(value => !value.includes('\0')),
  body: z.string().max(10000).trim().min(20).refine(value => !value.includes('\0')),
});
const commentEdit = identity.extend({ body: z.string().max(3000).trim().min(2).refine(value => !value.includes('\0')) });
const commentDelete = identity.extend({ requestId:z.uuid().transform(value=>value.toLowerCase()) });
const commentProjection = `comments.id,comments.resource,
  CASE WHEN comments.user_id IS NOT NULL THEN comments.author ELSE 'Deleted' END AS author,
  CASE WHEN comments.user_id IS NOT NULL THEN comments.body ELSE 'This comment was removed by its author.' END AS body,
  comments.created_at AS "createdAt",comments.parent_id AS "parentId"`;
const liveCommentProjection=`comments.id,comments.resource,comments.author,comments.body,
  comments.created_at AS "createdAt",comments.parent_id AS "parentId"`;
const commentDto = z.strictObject({
  id: z.string(), resource: z.string(), author: z.string(), body: z.string(),
  createdAt: z.string(), parentId: z.string().nullable(), isMine: z.union([z.literal(0),z.literal(1)]).transform(value => value === 1),
  deleted:z.union([z.literal(0),z.literal(1)]).transform(value=>value===1),
});
export { commentProjection, commentDto };
const commentPageQuery = z.strictObject({
  resource: z.string().max(205), limit: z.enum(['25','50']).transform(Number).default(50),
  cursor: z.string().max(4096).optional(),
});
const commentCursor = z.strictObject({
  version: z.literal('community-comments-v1'), hash: z.string().regex(/^[a-f0-9]{64}$/),
  id: communityIdentifierSchema, createdAt: z.string().min(1).max(200).refine(value => !value.includes('\0')),
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
    const rows = await this.db.prepare(`SELECT ${commentProjection},CASE WHEN comments.user_id=? THEN 1 ELSE 0 END AS "isMine",
      CASE WHEN comments.user_id IS NOT NULL THEN 0 ELSE 1 END AS deleted FROM comments
      LEFT JOIN community_comment_tombstones tombstone ON tombstone.comment_id=comments.id
      WHERE comments.resource=? ORDER BY comments.created_at ASC LIMIT 500`).all(owner,resource);
    return rows.map(row => commentDto.parse(row));
  }
  async commentPage(input: unknown, owner: string | null): Promise<CommunityCommentPage> {
    const parsed = commentPageQuery.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'Provide one discussion resource, supported page size and cursor.');
    const { cursor: encoded, ...raw } = parsed.data, query = { ...raw, resource: communityDiscussionResource(raw.resource) };
    const hash = digest(encodePayload({ query, viewer: owner })), cursor = communityPageCursor(encoded,commentCursor,hash);
    const rows = await this.db.prepare(`SELECT ${commentProjection},CASE WHEN comments.user_id=? THEN 1 ELSE 0 END AS "isMine",
      CASE WHEN comments.user_id IS NOT NULL THEN 0 ELSE 1 END AS deleted FROM comments
      LEFT JOIN community_comment_tombstones tombstone ON tombstone.comment_id=comments.id
      WHERE comments.resource=? ${cursor ? 'AND (comments.created_at,comments.id)>(?,?)' : ''}
      ORDER BY comments.created_at ASC,comments.id ASC LIMIT ?`)
      .all(owner,query.resource,...(cursor ? [cursor.createdAt,cursor.id] : []),query.limit+1);
    const comments = rows.slice(0,query.limit).map(row => commentDto.parse(row)), last = comments.at(-1);
    const nextCursor = rows.length > query.limit && last ? Buffer.from(JSON.stringify(commentCursor.parse({
      version:'community-comments-v1',hash,id:last.id,createdAt:last.createdAt,
    }))).toString('base64url') : null;
    return { comments, limit:query.limit, nextCursor };
  }
  async createdComment(id: string, owner: string): Promise<Comment> {
    const row = await this.db.prepare(`SELECT ${liveCommentProjection},1 AS "isMine",0 AS deleted
      FROM comments WHERE comments.id=? AND comments.user_id=?`).get(id,owner);
    if (!row) throw new Error('The admitted comment was not found after insertion.');
    return commentDto.parse(row);
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
    const row = await this.db.prepare(`SELECT ${liveCommentProjection},1 AS "isMine",0 AS deleted
      FROM comments WHERE comments.id=? AND comments.user_id=?
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
  async removeComment(input:unknown,owner:string,admit:()=>Promise<void>):Promise<CommunityCommentDeletion> {
    const parsed=commentDelete.safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide an exact comment identifier, saved revision and UUID deletion request key.');
    const request=parsed.data,hash=digest(encodePayload({owner,id:request.id,revision:request.revision}));
    return this.db.transaction(async()=>{
      await this.admitted(owner,admit);
      const existing=await this.db.prepare(`SELECT request_id,comment_id,resource,input_hash,prior_revision,result_revision,deleted_at
        FROM community_comment_deletions WHERE user_id=? AND request_id=?`).get(owner,request.requestId);
      if(existing){
        if(existing.input_hash!==hash)throw new HttpError(409,'This comment deletion key belongs to another saved deletion request.');
        return this.commentDeletion(existing);
      }
      const saved=await this.commentSnapshot(request.id,owner);this.assertRevision(saved,request.revision,'comment');
      if(saved.revision===2147483647)throw new HttpError(409,'This comment reached its revision limit and cannot publish a deletion tombstone.');
      const deletedAt=new Date().toISOString();
      await this.db.prepare(`INSERT INTO community_comment_deletions
        (user_id,request_id,comment_id,resource,input_hash,prior_revision,result_revision,deleted_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(owner,request.requestId,request.id,saved.comment.resource,hash,request.revision,request.revision+1,deletedAt);
      const row=await this.db.prepare(`SELECT request_id,comment_id,resource,input_hash,prior_revision,result_revision,deleted_at
        FROM community_comment_deletions WHERE user_id=? AND request_id=?`).get(owner,request.requestId);
      if(!row)throw new Error('The admitted comment deletion receipt was not found.');
      return this.commentDeletion(row);
    });
  }
  private async commentDeletion(value:Record<string,unknown>):Promise<CommunityCommentDeletion> {
    const receipt=z.object({
      request_id:z.uuid(),comment_id:communityIdentifierSchema,resource:z.string().min(1).max(205),
      prior_revision:revision,result_revision:revision,deleted_at:z.iso.datetime(),input_hash:z.string(),
    }).parse(value);
    const row=await this.db.prepare(`SELECT ${commentProjection},0 AS "isMine",1 AS deleted FROM comments
      JOIN community_comment_tombstones tombstone ON tombstone.comment_id=comments.id WHERE comments.id=?`).get(receipt.comment_id);
    return {receipt:{requestId:receipt.request_id,commentId:receipt.comment_id,resource:receipt.resource,
      deletedAt:receipt.deleted_at,priorRevision:receipt.prior_revision,resultRevision:receipt.result_revision,status:'tombstoned'},
      comment:row?commentDto.parse(row):null};
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
