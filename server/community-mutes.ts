import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {CommunityMutePage,CommunityMuteReceipt,User} from '../shared/types';
import type {Database} from './db/connection';
import {communityIdentifierSchema,communityPageCursor} from './community';
import {HttpError} from './http-error';
import {digest,encodePayload} from './jobs/schema';

const targetType=z.enum(['post','comment']);
const input=z.discriminatedUnion('muted',[
  z.strictObject({
    requestId:z.uuid().transform(value=>value.toLowerCase()),muted:z.literal(true),
    targetType,targetId:communityIdentifierSchema,
  }),
  z.strictObject({
    requestId:z.uuid().transform(value=>value.toLowerCase()),muted:z.literal(false),
    muteId:z.uuid(),revision:z.number().int().positive(),
  }),
]);
const receiptRow=z.object({
  request_key:z.uuid(),mute_id:z.uuid(),target_type:targetType,target_id:communityIdentifierSchema,
  muted:z.union([z.boolean(),z.literal(0),z.literal(1)]).transform(Boolean),
  result_revision:z.number().int().positive(),created_at:z.string(),
});
const muteRow=z.object({
  id:z.uuid(),target_type:targetType,target_id:communityIdentifierSchema,revision:z.number().int().positive(),
  created_at:z.string(),updated_at:z.string(),
});
const cursor=z.strictObject({
  version:z.literal('community-mutes-v1'),hash:z.string().length(64),updatedAt:z.iso.datetime(),id:z.uuid(),
});
const uuid=(db:Database)=>db.dialect==='postgres'?'?::uuid':'?';
const boolean=(db:Database)=>db.dialect==='postgres'?'?::boolean':'?';
const flag=(db:Database,value:boolean)=>db.dialect==='postgres'?String(value):Number(value);

export class CommunityMutes {
  constructor(private readonly db:Database) {}
  private async lock(owner:string,subject:string) {
    if(this.db.dialect!=='postgres')return;
    const value=parseInt(digest(`${owner}:${subject}`).slice(0,8),16),key=value>2147483647?value-4294967296:value;
    await this.db.prepare('SELECT pg_advisory_xact_lock(?)').get(key);
  }
  private receipt(value:unknown):CommunityMuteReceipt {
    const row=receiptRow.parse(value);
    return {id:row.mute_id,requestId:row.request_key,targetType:row.target_type,targetId:row.target_id,
      muted:row.muted,revision:row.result_revision,createdAt:row.created_at};
  }
  private async subject(owner:string,type:'post'|'comment',id:string) {
    const row=type==='post'
      ?await this.db.prepare(`SELECT author_id AS subject FROM posts p WHERE p.id=? AND p.sample=0 AND
        NOT EXISTS(SELECT 1 FROM community_moderation_targets target
          WHERE target.target_type='post' AND target.target_id=p.id AND target.state='hidden')`).get(id)
      :await this.db.prepare(`SELECT comments.user_id AS subject FROM comments
        LEFT JOIN community_comment_tombstones tombstone ON tombstone.comment_id=comments.id
        LEFT JOIN community_moderation_targets target ON target.target_type='comment' AND target.target_id=comments.id
        WHERE comments.id=? AND comments.user_id IS NOT NULL AND tombstone.comment_id IS NULL AND
          COALESCE(target.state,'visible')='visible'`).get(id);
    if(!row?.subject)throw new HttpError(404,'This live community contribution is unavailable for muting.');
    const subject=z.string().parse(row.subject);
    if(subject===owner)throw new HttpError(409,'You cannot mute your own community contributions.');
    return subject;
  }
  async set(user:User,value:unknown,admit:()=>Promise<void>):Promise<CommunityMuteReceipt> {
    const parsed=input.safeParse(value);
    if(!parsed.success)throw new HttpError(400,'Provide one UUID request key and either a live contribution to mute or the current owned mute revision to unmute.');
    const request=parsed.data,hash=digest(encodePayload({owner:user.id,...request}));
    return this.db.transaction(async()=>{
      await admit();
      const existing=await this.db.prepare(`SELECT intents.request_key,intents.mute_id,intents.target_type,intents.target_id,
        intents.muted,intents.result_revision,intents.created_at,intents.input_hash
        FROM community_mute_intents intents WHERE intents.owner_id=? AND intents.request_key=${uuid(this.db)}`)
        .get(user.id,request.requestId);
      if(existing){
        if(existing.input_hash!==hash)throw new HttpError(409,'This community mute key belongs to different desired-state input.');
        await admit();return this.receipt(existing);
      }
      let subject:string,current:Record<string,unknown>|undefined;
      if(request.muted){
        subject=await this.subject(user.id,request.targetType,request.targetId);
        await this.lock(user.id,subject);
        current=await this.db.prepare(`SELECT * FROM community_mutes WHERE owner_id=? AND subject_id=?
          ${this.db.dialect==='postgres'?'FOR UPDATE':''}`).get(user.id,subject);
      }else{
        current=await this.db.prepare(`SELECT * FROM community_mutes WHERE id=${uuid(this.db)} AND owner_id=?`).get(request.muteId,user.id);
        if(!current)throw new HttpError(404,'This personal mute is unavailable.');
        subject=z.string().parse(current.subject_id);
        await this.lock(user.id,subject);
        current=await this.db.prepare(`SELECT * FROM community_mutes WHERE id=${uuid(this.db)} AND owner_id=?
          ${this.db.dialect==='postgres'?'FOR UPDATE':''}`).get(request.muteId,user.id);
        if(!current)throw new HttpError(404,'This personal mute is unavailable.');
        if(Number(current.revision)!==request.revision)throw new HttpError(409,'This personal mute changed. Reload its current revision.');
      }
      let target:{type:'post'|'comment';id:string};
      if(request.muted)target={type:request.targetType,id:request.targetId};
      else {
        if(!current)throw new HttpError(404,'This personal mute is unavailable.');
        target={type:targetType.parse(current.target_type),id:communityIdentifierSchema.parse(current.target_id)};
      }
      const prior=current?z.number().int().positive().parse(current.revision):0;
      let muteId=current?z.uuid().parse(current.id):randomUUID(),result=prior;
      const desired=request.muted?'muted':'unmuted',now=new Date().toISOString();
      if(!current){
        await this.db.prepare(`INSERT INTO community_mutes
          (id,owner_id,subject_id,target_type,target_id,state,revision,created_at,updated_at)
          VALUES(${uuid(this.db)},?,?,?,?,'muted',1,?,?)`).run(muteId,user.id,subject,target.type,target.id,now,now);
        result=1;
      }else if(current.state!==desired){
        const changed=await this.db.prepare(`UPDATE community_mutes SET state=?,revision=revision+1,updated_at=?
          WHERE id=${uuid(this.db)} AND owner_id=? AND revision=?`).run(desired,now,muteId,user.id,prior);
        if(changed!==1)throw new HttpError(409,'This personal mute changed before the requested state was saved.');
        result=prior+1;
      }
      await this.db.prepare(`INSERT INTO community_mute_intents
        (owner_id,request_key,input_hash,mute_id,target_type,target_id,muted,prior_revision,result_revision,created_at)
        VALUES(?,${uuid(this.db)},?,${uuid(this.db)},?,?,${boolean(this.db)},?,?,?)`)
        .run(user.id,request.requestId,hash,muteId,target.type,target.id,flag(this.db,request.muted),prior,result,now);
      const saved=await this.db.prepare(`SELECT request_key,mute_id,target_type,target_id,muted,result_revision,created_at
        FROM community_mute_intents WHERE owner_id=? AND request_key=${uuid(this.db)}`).get(user.id,request.requestId);
      await admit();return this.receipt(saved);
    });
  }
  async history(user:User,value:unknown,admit:()=>Promise<void>):Promise<CommunityMutePage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(value);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional personal-mute cursor.');
    const hash=digest(`community-mutes:${user.id}`);
    const saved=parsed.data.cursor?communityPageCursor(parsed.data.cursor,cursor,hash):undefined;
    return this.db.transaction(async()=>{
      await admit();
      const rows=await this.db.prepare(`SELECT id,target_type,target_id,revision,created_at,updated_at FROM community_mutes
        WHERE owner_id=? AND state='muted' ${saved?'AND (updated_at,id)<(?,?)':''}
        ORDER BY updated_at DESC,id DESC LIMIT 21`).all(user.id,...(saved?[saved.updatedAt,saved.id]:[]));
      const page=rows.slice(0,20),last=page.at(-1)&&muteRow.parse(page.at(-1));
      await admit();
      return {mutes:page.map(value=>{const row=muteRow.parse(value);return {id:row.id,targetType:row.target_type,
        targetId:row.target_id,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};}),
      nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({version:'community-mutes-v1',hash,
        updatedAt:last.updated_at,id:last.id})).toString('base64url'):null};
    });
  }
}
