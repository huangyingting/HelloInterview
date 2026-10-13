import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CommunityCommentSubmission, CommunityCommentSubmissionHistory, User } from '../shared/types';
import type { Database } from './db/connection';
import { commentDto } from './community-contributions';
import { communityDiscussionResource, communityIdentifierSchema, communityPageCursor } from './community';
import { digest, encodePayload } from './jobs/schema';
import { HttpError } from './http-error';

const key = z.uuid().transform(value => value.toLowerCase());
const inputSchema = z.strictObject({
  requestId:key,resource:z.string().max(205),body:z.string().max(10000).trim().min(2).max(3000).refine(value=>!value.includes('\0')),
  parentId:communityIdentifierSchema.nullable().default(null),
}).refine(value=>[value.resource,value.body,value.parentId].every(text=>text===null||Buffer.from(text,'utf8').toString('utf8')===text));
const receiptSchema = z.strictObject({
  requestId:key,commentId:z.uuid(),resource:z.string().min(1).max(205),createdAt:z.iso.datetime(),status:z.literal('created'),
});
const cursorSchema = z.strictObject({
  version:z.literal('comment-submissions-v1'),hash:z.string().regex(/^[a-f0-9]{64}$/),requestId:key,createdAt:z.iso.datetime(),
});

export class CommunitySubmissions {
  constructor(private readonly db: Database) {}
  private async admitted(owner:string,admit:()=>Promise<void>) {
    if(!await this.db.prepare(`SELECT id FROM users WHERE id=?${this.db.dialect==='postgres'?' FOR UPDATE':''}`).get(owner))
      throw new HttpError(401,'Sign in to check or submit your comment.');
    await admit();
  }
  private selection() {
    return `s.request_id,s.comment_id,s.resource,s.created_at,c.id AS current_id,c.resource AS current_resource,
      c.author AS current_author,c.body AS current_body,c.created_at AS current_created_at,c.parent_id AS current_parent`;
  }
  private joins() {
    return `FROM community_comment_submissions s LEFT JOIN comments c ON c.id=s.comment_id AND c.user_id=s.user_id
      AND c.resource=s.resource AND c.created_at=s.created_at
      AND NOT EXISTS(SELECT 1 FROM community_moderation_targets hidden_comment
        WHERE hidden_comment.target_type='comment' AND hidden_comment.target_id=c.id AND hidden_comment.state='hidden')
      AND (substr(s.resource,1,5)<>'post/' OR EXISTS(SELECT 1 FROM posts p WHERE p.id=substr(s.resource,6)
        AND NOT EXISTS(SELECT 1 FROM community_moderation_targets hidden_post
          WHERE hidden_post.target_type='post' AND hidden_post.target_id=p.id AND hidden_post.state='hidden')))`;
  }
  private envelope(row:Record<string,unknown>):CommunityCommentSubmission {
    const receipt=receiptSchema.parse({requestId:row.request_id,commentId:row.comment_id,resource:row.resource,createdAt:row.created_at,status:'created'});
    const comment=row.current_id===null?null:commentDto.parse({id:row.current_id,resource:row.current_resource,author:row.current_author,
      body:row.current_body,createdAt:row.current_created_at,parentId:row.current_parent,isMine:1,deleted:0,moderated:0,moderationRevision:0});
    return {receipt,comment};
  }
  private async snapshot(owner:string,requestId:string) {
    const row=await this.db.prepare(`SELECT ${this.selection()} ${this.joins()} WHERE s.user_id=? AND s.request_id=?`).get(owner,requestId);
    if(!row)throw new HttpError(404,'No recorded comment submission was found for this key. A request may still be in progress; retry only its original key and content.');
    return this.envelope(row);
  }
  async create(user:Pick<User,'id'|'name'>,input:unknown,admit:()=>Promise<void>) {
    const parsed=inputSchema.safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide a unique submission key, exact discussion/reply identifiers and 2-3,000 characters of valid original text.');
    const request={...parsed.data,resource:communityDiscussionResource(parsed.data.resource)},hash=digest(encodePayload({owner:user.id,request}));
    return this.db.transaction(async()=>{
      await this.admitted(user.id,admit);
      const existing=await this.db.prepare('SELECT input_hash FROM community_comment_submissions WHERE user_id=? AND request_id=?').get(user.id,request.requestId);
      if(existing){
        if(existing.input_hash!==hash)throw new HttpError(409,'This submission key belongs to different original content. Nothing was replaced or created.');
        return this.snapshot(user.id,request.requestId);
      }
      if(request.resource.startsWith('post/')&&!await this.db.prepare(`SELECT p.id FROM posts p WHERE p.id=? AND NOT EXISTS(
        SELECT 1 FROM community_moderation_targets moderation WHERE moderation.target_type='post'
          AND moderation.target_id=p.id AND moderation.state='hidden')${this.db.dialect==='postgres'?' FOR UPDATE OF p':''}`).get(request.resource.slice(5)))
        throw new HttpError(404,'This post is no longer available for discussion.');
      if(request.parentId&&!await this.db.prepare(`SELECT comments.id FROM comments
        LEFT JOIN community_comment_tombstones tombstone ON tombstone.comment_id=comments.id
        LEFT JOIN community_moderation_targets moderation ON moderation.target_type='comment' AND moderation.target_id=comments.id
        WHERE comments.id=? AND comments.resource=? AND comments.user_id IS NOT NULL AND tombstone.comment_id IS NULL
          AND COALESCE(moderation.state,'visible')<>'hidden'`).get(request.parentId,request.resource))
        throw new HttpError(400,'Reply must belong to this exact discussion.');
      const id=randomUUID(),createdAt=new Date().toISOString();
      await this.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,request.resource,user.id,user.name,request.body,createdAt,request.parentId);
      await this.db.prepare('INSERT INTO community_comment_submissions(user_id,request_id,comment_id,resource,input_hash,created_at) VALUES(?,?,?,?,?,?)')
        .run(user.id,request.requestId,id,request.resource,hash,createdAt);
      return this.snapshot(user.id,request.requestId);
    });
  }
  async read(owner:string,input:unknown,admit:()=>Promise<void>) {
    const parsed=z.strictObject({requestId:key}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only one valid comment submission key.');
    return this.db.transaction(async()=>{await this.admitted(owner,admit);return this.snapshot(owner,parsed.data.requestId);});
  }
  async history(owner:string,input:unknown,admit:()=>Promise<void>):Promise<CommunityCommentSubmissionHistory> {
    const parsed=z.strictObject({resource:z.string().max(205).optional(),cursor:z.string().max(4096).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional exact discussion resource and owned history cursor.');
    const resource=parsed.data.resource===undefined?null:communityDiscussionResource(parsed.data.resource);
    const hash=digest(encodePayload({resource,viewer:owner})),cursor=communityPageCursor(parsed.data.cursor,cursorSchema,hash);
    return this.db.transaction(async()=>{
      await this.admitted(owner,admit);
      const rows=await this.db.prepare(`SELECT ${this.selection()} ${this.joins()} WHERE s.user_id=?
        ${resource!==null?'AND s.resource=?':''} ${cursor?'AND (s.created_at,s.request_id)<(?,?)':''}
        ORDER BY s.created_at DESC,s.request_id DESC LIMIT 11`)
        .all(owner,...(resource!==null?[resource]:[]),...(cursor?[cursor.createdAt,cursor.requestId]:[]));
      const submissions=rows.slice(0,10).map(row=>this.envelope(row)),last=submissions.at(-1)?.receipt;
      const nextCursor=rows.length>10&&last?Buffer.from(JSON.stringify({version:'comment-submissions-v1',hash,requestId:last.requestId,createdAt:last.createdAt})).toString('base64url'):null;
      return {submissions,nextCursor};
    });
  }
}
