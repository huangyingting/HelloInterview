import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {
  CommunityAppealReceipt,CommunityAppealStatus,CommunityAppealStatusPage,CommunityReportReceipt,
  CommunityReportStatus,CommunityReportStatusPage,StaffCommunityAppeal,StaffCommunityAppealPage,
  StaffCommunityReport,StaffCommunityReportPage,StaffRole,User,
} from '../shared/types';
import type {Database} from './db/connection';
import type {ManagedIdentity} from './identity';
import {HttpError} from './http-error';
import {communityIdentifierSchema,communityPageCursor} from './community';
import {digest,encodePayload} from './jobs/schema';

const targetType=z.enum(['post','comment']),category=z.enum(['spam','harassment','privacy','misinformation','other']);
const reportInput=z.strictObject({
  requestId:z.uuid().transform(value=>value.toLowerCase()),targetType,targetId:communityIdentifierSchema,category,
  details:z.string().trim().min(20).max(1000).refine(value=>!value.includes('\0')),
});
const reportRow=z.object({
  id:z.uuid(),request_key:z.uuid(),target_type:targetType,target_id:communityIdentifierSchema,category,
  details:z.string(),state:z.enum(['open','dismissed','actioned']),report_revision:z.number().int().nonnegative(),
  assigned_to:z.string().nullable(),created_at:z.string(),updated_at:z.string(),
  target_state:z.enum(['visible','hidden']).nullable(),target_revision:z.number().int().nonnegative().nullable(),
});
const staffCursor=z.strictObject({version:z.literal('community-moderation-v1'),hash:z.literal('community-moderation'),updatedAt:z.iso.datetime(),id:z.uuid()});
const actionInput=z.strictObject({
  revision:z.number().int().nonnegative(),targetRevision:z.number().int().nonnegative(),
  action:z.enum(['claim','release','dismiss','hide','restore']),
  reason:z.string().trim().min(20).max(500).refine(value=>!value.includes('\0')),
});
const appealInput=z.strictObject({
  requestId:z.uuid().transform(value=>value.toLowerCase()),targetType,targetId:communityIdentifierSchema,
  targetRevision:z.number().int().positive(),
  statement:z.string().trim().min(20).max(1000).refine(value=>!value.includes('\0')),
});
const appealRow=z.object({
  id:z.uuid(),request_key:z.uuid(),target_type:targetType,target_id:communityIdentifierSchema,
  target_revision:z.number().int().positive(),statement:z.string(),state:z.enum(['open','denied','upheld']),
  appeal_revision:z.number().int().nonnegative(),assigned_to:z.string().nullable(),created_at:z.string(),updated_at:z.string(),
  current_target_state:z.enum(['visible','hidden']).nullable(),current_target_revision:z.number().int().nonnegative().nullable(),
});
const appealActionInput=z.strictObject({
  revision:z.number().int().nonnegative(),targetRevision:z.number().int().positive(),
  action:z.enum(['claim','release','deny','uphold']),
  reason:z.string().trim().min(20).max(500).refine(value=>!value.includes('\0')),
});
const reportHistoryCursor=z.strictObject({
  version:z.literal('community-report-history-v1'),hash:z.string().length(64),createdAt:z.iso.datetime(),id:z.uuid(),
});
const appealHistoryCursor=z.strictObject({
  version:z.literal('community-appeal-history-v1'),hash:z.string().length(64),createdAt:z.iso.datetime(),id:z.uuid(),
});
const staffAppealCursor=z.strictObject({
  version:z.literal('community-appeal-queue-v1'),hash:z.literal('community-appeals'),updatedAt:z.iso.datetime(),id:z.uuid(),
});

export class CommunityModeration {
  constructor(private readonly db:Database,private readonly identity:ManagedIdentity|null) {}
  private async lockTarget(type:'post'|'comment',id:string) {
    if(this.db.dialect!=='postgres')return;
    const value=parseInt(digest(`${type}:${id}`).slice(0,8),16),key=value>2147483647?value-4294967296:value;
    await this.db.prepare('SELECT pg_advisory_xact_lock(?)').get(key);
  }
  private receipt(value:unknown):CommunityReportReceipt {
    const row=reportRow.parse(value);
    return {id:row.id,requestId:row.request_key,targetType:row.target_type,targetId:row.target_id,
      category:row.category,status:'saved',createdAt:row.created_at,delivery:'moderation-queue-only'};
  }
  private async targetExists(type:'post'|'comment',id:string,visibleOnly=true,lock=false) {
    if(type==='post')return !!await this.db.prepare(`SELECT p.id FROM posts p
      WHERE p.id=? ${visibleOnly?`AND NOT EXISTS(SELECT 1 FROM community_moderation_targets target
        WHERE target.target_type='post' AND target.target_id=p.id AND target.state='hidden')`:''}
      ${lock&&this.db.dialect==='postgres'?'FOR UPDATE OF p':''}`).get(id);
    return !!await this.db.prepare(`SELECT comments.id FROM comments
      WHERE comments.id=? AND comments.user_id IS NOT NULL ${visibleOnly?`AND NOT EXISTS(
        SELECT 1 FROM community_moderation_targets target WHERE target.target_type='comment'
          AND target.target_id=comments.id AND target.state='hidden')`:''}
      ${lock&&this.db.dialect==='postgres'?'FOR UPDATE OF comments':''}`).get(id);
  }
  private async ownsTarget(type:'post'|'comment',id:string,owner:string,lock=false) {
    if(type==='post')return !!await this.db.prepare(`SELECT id FROM posts WHERE id=? AND author_id=?
      ${lock&&this.db.dialect==='postgres'?'FOR UPDATE':''}`).get(id,owner);
    return !!await this.db.prepare(`SELECT comments.id FROM comments
      LEFT JOIN community_comment_tombstones tombstone ON tombstone.comment_id=comments.id
      WHERE comments.id=? AND comments.user_id=? AND tombstone.comment_id IS NULL
      ${lock&&this.db.dialect==='postgres'?'FOR UPDATE OF comments':''}`).get(id,owner);
  }
  async report(user:User,input:unknown,admit:()=>Promise<void>):Promise<CommunityReportReceipt> {
    const parsed=reportInput.safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide one exact post or live comment, a report category, UUID request key and 20-1,000 character details.');
    const request=parsed.data,{requestId:_,...content}=request,hash=digest(encodePayload({owner:user.id,...content}));
    return this.db.transaction(async()=>{
      await admit();
      const existing=await this.db.prepare(`SELECT reports.*,target.state AS target_state,target.revision AS target_revision
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        WHERE reports.reporter_id=? AND reports.request_key=?`).get(user.id,request.requestId);
      if(existing){
        if(existing.input_hash!==hash)throw new HttpError(409,'This community report key belongs to different report content.');
        await admit();
        return this.receipt(existing);
      }
      await this.lockTarget(request.targetType,request.targetId);
      const concurrent=await this.db.prepare(`SELECT reports.*,target.state AS target_state,target.revision AS target_revision
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        WHERE reports.reporter_id=? AND reports.request_key=?`).get(user.id,request.requestId);
      if(concurrent){
        if(concurrent.input_hash!==hash)throw new HttpError(409,'This community report key belongs to different report content.');
        await admit();
        return this.receipt(concurrent);
      }
      if(!await this.targetExists(request.targetType,request.targetId,true,true))throw new HttpError(404,'This community contribution is unavailable for reporting.');
      const duplicate=await this.db.prepare(`SELECT id FROM community_reports WHERE reporter_id=? AND target_type=? AND target_id=? AND state='open'`).get(
        user.id,request.targetType,request.targetId);
      if(duplicate)throw new HttpError(409,'You already have an open report for this contribution.');
      const count=await this.db.prepare(`SELECT count(*) AS count FROM community_reports WHERE reporter_id=? AND state='open'`).get(user.id);
      if(Number(count?.count)>=20)throw new HttpError(409,'Resolve existing community reports before submitting another.');
      const id=randomUUID(),now=new Date().toISOString();
      await this.db.prepare(`INSERT INTO community_reports
        (id,reporter_id,request_key,input_hash,target_type,target_id,category,details,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,user.id,request.requestId,hash,request.targetType,request.targetId,request.category,request.details,now,now);
      const saved=await this.db.prepare(`SELECT reports.*,NULL AS target_state,NULL AS target_revision FROM community_reports reports WHERE id=?`).get(id);
      if(!saved)throw new Error('The admitted community report was not found.');
      await admit();
      return this.receipt(saved);
    });
  }
  private reportStatus(value:unknown):CommunityReportStatus {
    const row=reportRow.parse(value);
    return {id:row.id,requestId:row.request_key,targetType:row.target_type,targetId:row.target_id,category:row.category,
      status:row.state,targetState:row.target_state??'visible',targetRevision:row.target_revision??0,
      createdAt:row.created_at,updatedAt:row.updated_at};
  }
  async reportHistory(user:User,input:unknown,admit:()=>Promise<void>):Promise<CommunityReportStatusPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional report-history cursor.');
    const hash=digest(`community-report-history:${user.id}`);
    let cursor:z.infer<typeof reportHistoryCursor>|undefined;
    if(parsed.data.cursor)cursor=communityPageCursor(parsed.data.cursor,reportHistoryCursor,hash);
    return this.db.transaction(async()=>{
      await admit();
      const rows=await this.db.prepare(`SELECT reports.*,target.state AS target_state,target.revision AS target_revision
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        WHERE reports.reporter_id=? ${cursor?'AND (reports.created_at,reports.id)<(?,?)':''}
        ORDER BY reports.created_at DESC,reports.id DESC LIMIT 21`)
        .all(user.id,...(cursor?[cursor.createdAt,cursor.id]:[]));
      const page=rows.slice(0,20),last=page.at(-1)&&reportRow.parse(page.at(-1));
      await admit();
      return {reports:page.map(value=>this.reportStatus(value)),nextCursor:rows.length>20&&last
        ?Buffer.from(JSON.stringify({version:'community-report-history-v1',hash,createdAt:last.created_at,id:last.id})).toString('base64url'):null};
    });
  }
  private appealReceipt(value:unknown):CommunityAppealReceipt {
    const row=appealRow.parse(value);
    return {id:row.id,requestId:row.request_key,targetType:row.target_type,targetId:row.target_id,
      appealedTargetRevision:row.target_revision,status:'saved',createdAt:row.created_at,delivery:'moderation-queue-only'};
  }
  private appealStatus(value:unknown):CommunityAppealStatus {
    const row=appealRow.parse(value);
    return {id:row.id,requestId:row.request_key,targetType:row.target_type,targetId:row.target_id,
      appealedTargetRevision:row.target_revision,status:row.state,revision:row.appeal_revision,
      targetState:row.current_target_state??'visible',targetRevision:row.current_target_revision??0,
      createdAt:row.created_at,updatedAt:row.updated_at};
  }
  async appeal(user:User,input:unknown,admit:()=>Promise<void>):Promise<CommunityAppealReceipt> {
    const parsed=appealInput.safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide one owned hidden contribution, its current positive revision, a UUID request key and a 20-1,000 character appeal statement.');
    const request=parsed.data,{requestId:_,...content}=request,hash=digest(encodePayload({owner:user.id,...content}));
    return this.db.transaction(async()=>{
      await admit();
      const select=`SELECT appeals.*,target.state AS current_target_state,target.revision AS current_target_revision
        FROM community_appeals appeals LEFT JOIN community_moderation_targets target
          ON target.target_type=appeals.target_type AND target.target_id=appeals.target_id`;
      const existing=await this.db.prepare(`${select} WHERE appeals.owner_id=? AND appeals.request_key=?`).get(user.id,request.requestId);
      if(existing){
        if(existing.input_hash!==hash)throw new HttpError(409,'This community appeal key belongs to different appeal content.');
        await admit();return this.appealReceipt(existing);
      }
      await this.lockTarget(request.targetType,request.targetId);
      const concurrent=await this.db.prepare(`${select} WHERE appeals.owner_id=? AND appeals.request_key=?`).get(user.id,request.requestId);
      if(concurrent){
        if(concurrent.input_hash!==hash)throw new HttpError(409,'This community appeal key belongs to different appeal content.');
        await admit();return this.appealReceipt(concurrent);
      }
      const target=await this.db.prepare(`SELECT state,revision FROM community_moderation_targets
        WHERE target_type=? AND target_id=? ${this.db.dialect==='postgres'?'FOR UPDATE':''}`).get(request.targetType,request.targetId);
      if(target?.state!=='hidden'||Number(target.revision)!==request.targetRevision)
        throw new HttpError(409,'Appeal the current hidden moderation revision after reloading the contribution.');
      if(!await this.ownsTarget(request.targetType,request.targetId,user.id,true))
        throw new HttpError(404,'This hidden contribution is unavailable for an owner appeal.');
      const duplicate=await this.db.prepare(`SELECT id FROM community_appeals
        WHERE owner_id=? AND target_type=? AND target_id=? AND target_revision=?`)
        .get(user.id,request.targetType,request.targetId,request.targetRevision);
      if(duplicate)throw new HttpError(409,'You already appealed this hidden moderation revision.');
      const count=await this.db.prepare(`SELECT count(*) AS count FROM community_appeals WHERE owner_id=? AND state='open'`).get(user.id);
      if(Number(count?.count)>=20)throw new HttpError(409,'Resolve existing community appeals before submitting another.');
      const id=randomUUID(),now=new Date().toISOString();
      await this.db.prepare(`INSERT INTO community_appeals
        (id,owner_id,request_key,input_hash,target_type,target_id,target_revision,statement,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(id,user.id,request.requestId,hash,request.targetType,request.targetId,request.targetRevision,request.statement,now,now);
      const saved=await this.db.prepare(`${select} WHERE appeals.id=?`).get(id);
      if(!saved)throw new Error('The admitted community appeal was not found.');
      await admit();return this.appealReceipt(saved);
    });
  }
  async appealHistory(user:User,input:unknown,admit:()=>Promise<void>):Promise<CommunityAppealStatusPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional appeal-history cursor.');
    const hash=digest(`community-appeal-history:${user.id}`);
    let cursor:z.infer<typeof appealHistoryCursor>|undefined;
    if(parsed.data.cursor)cursor=communityPageCursor(parsed.data.cursor,appealHistoryCursor,hash);
    return this.db.transaction(async()=>{
      await admit();
      const rows=await this.db.prepare(`SELECT appeals.*,target.state AS current_target_state,target.revision AS current_target_revision
        FROM community_appeals appeals LEFT JOIN community_moderation_targets target
          ON target.target_type=appeals.target_type AND target.target_id=appeals.target_id
        WHERE appeals.owner_id=? ${cursor?'AND (appeals.created_at,appeals.id)<(?,?)':''}
        ORDER BY appeals.created_at DESC,appeals.id DESC LIMIT 21`)
        .all(user.id,...(cursor?[cursor.createdAt,cursor.id]:[]));
      const page=rows.slice(0,20),last=page.at(-1)&&appealRow.parse(page.at(-1));
      await admit();
      return {appeals:page.map(value=>this.appealStatus(value)),nextCursor:rows.length>20&&last
        ?Buffer.from(JSON.stringify({version:'community-appeal-history-v1',hash,createdAt:last.created_at,id:last.id})).toString('base64url'):null};
    });
  }
  private async authorize(user:User) {
    if(!this.identity)throw new HttpError(404,'Community moderation is not configured.');
    await this.identity.assertStaff(user);
    const roles=await this.identity.staffRoles(user.id),role=roles.find(value=>value==='moderator'||value==='administrator');
    if(!role)throw new HttpError(403,'Your current staff role does not permit community moderation.');
    return role as Extract<StaffRole,'moderator'|'administrator'>;
  }
  private async target(type:'post'|'comment',id:string) {
    if(type==='post'){
      const row=await this.db.prepare(`SELECT title,body,CASE WHEN kind='questions' THEN 'Anonymous' ELSE author END AS author,
        NULL::text AS resource FROM posts WHERE id=?`).get(id);
      if(!row)return {title:'Contribution unavailable',body:'The reported post is no longer stored.',author:'Unavailable',resource:null};
      return {title:z.string().parse(row.title),body:z.string().parse(row.body),author:z.string().parse(row.author),resource:null};
    }
    const row=await this.db.prepare('SELECT NULL::text AS title,body,author,resource FROM comments WHERE id=?').get(id);
    if(!row)return {title:null,body:'The reported comment is no longer stored.',author:'Unavailable',resource:null};
    return {title:null,body:z.string().parse(row.body),author:z.string().parse(row.author),resource:z.string().parse(row.resource)};
  }
  private async dto(value:unknown,actor:string):Promise<StaffCommunityReport> {
    const row=reportRow.parse(value);
    return {id:row.id,targetType:row.target_type,targetId:row.target_id,category:row.category,details:row.details,
      status:row.state,revision:row.report_revision,assignment:row.assigned_to===null?null:row.assigned_to===actor?'me':'other',
      targetState:row.target_state??'visible',targetRevision:row.target_revision??0,createdAt:row.created_at,updatedAt:row.updated_at,
      target:await this.target(row.target_type,row.target_id)};
  }
  async queue(user:User,input:unknown):Promise<StaffCommunityReportPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional moderation queue cursor.');
    let cursor:z.infer<typeof staffCursor>|undefined;
    if(parsed.data.cursor)cursor=communityPageCursor(parsed.data.cursor,staffCursor,'community-moderation');
    return this.db.transaction(async()=>{
      await this.authorize(user);
      const rows=await this.db.prepare(`SELECT reports.*,target.state AS target_state,target.revision AS target_revision
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        ${cursor?'WHERE (reports.updated_at,reports.id)<(?,?)':''}
        ORDER BY reports.updated_at DESC,reports.id DESC LIMIT 21`).all(...(cursor?[cursor.updatedAt,cursor.id]:[]));
      const page=rows.slice(0,20),reports=await Promise.all(page.map(row=>this.dto(row,user.id))),last=page.at(-1)&&reportRow.parse(page.at(-1));
      await this.authorize(user);
      return {reports,nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({version:'community-moderation-v1',
        hash:'community-moderation',updatedAt:last.updated_at,id:last.id})).toString('base64url'):null};
    });
  }
  private async appealDto(value:unknown,actor:string):Promise<StaffCommunityAppeal> {
    const row=appealRow.parse(value);
    return {id:row.id,targetType:row.target_type,targetId:row.target_id,statement:row.statement,
      appealedTargetRevision:row.target_revision,status:row.state,revision:row.appeal_revision,
      assignment:row.assigned_to===null?null:row.assigned_to===actor?'me':'other',
      targetState:row.current_target_state??'visible',targetRevision:row.current_target_revision??0,
      createdAt:row.created_at,updatedAt:row.updated_at,target:await this.target(row.target_type,row.target_id)};
  }
  async appealQueue(user:User,input:unknown):Promise<StaffCommunityAppealPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional appeal queue cursor.');
    let cursor:z.infer<typeof staffAppealCursor>|undefined;
    if(parsed.data.cursor)cursor=communityPageCursor(parsed.data.cursor,staffAppealCursor,'community-appeals');
    return this.db.transaction(async()=>{
      await this.authorize(user);
      const rows=await this.db.prepare(`SELECT appeals.*,target.state AS current_target_state,target.revision AS current_target_revision
        FROM community_appeals appeals LEFT JOIN community_moderation_targets target
          ON target.target_type=appeals.target_type AND target.target_id=appeals.target_id
        ${cursor?'WHERE (appeals.updated_at,appeals.id)<(?,?)':''}
        ORDER BY appeals.updated_at DESC,appeals.id DESC LIMIT 21`).all(...(cursor?[cursor.updatedAt,cursor.id]:[]));
      const page=rows.slice(0,20),appeals=await Promise.all(page.map(row=>this.appealDto(row,user.id))),
        last=page.at(-1)&&appealRow.parse(page.at(-1));
      await this.authorize(user);
      return {appeals,nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({version:'community-appeal-queue-v1',
        hash:'community-appeals',updatedAt:last.updated_at,id:last.id})).toString('base64url'):null};
    });
  }
  async actOnAppeal(user:User,id:unknown,input:unknown):Promise<StaffCommunityAppeal> {
    const appealId=z.uuid().safeParse(id),parsed=appealActionInput.safeParse(input);
    if(!appealId.success||!parsed.success)
      throw new HttpError(400,'Choose one appeal, current appeal/target revisions, one supported action and a 20-500 character reason.');
    return this.db.transaction(async()=>{
      const role=await this.authorize(user);
      const raw=await this.db.prepare(`SELECT appeals.*,target.state AS current_target_state,target.revision AS current_target_revision
        FROM community_appeals appeals LEFT JOIN community_moderation_targets target
          ON target.target_type=appeals.target_type AND target.target_id=appeals.target_id
        WHERE appeals.id=? FOR UPDATE OF appeals`).get(appealId.data);
      if(!raw)throw new HttpError(404,'Community appeal not found.');
      const current=appealRow.parse(raw);
      await this.lockTarget(current.target_type,current.target_id);
      const targetRow=await this.db.prepare(`SELECT state,revision FROM community_moderation_targets
        WHERE target_type=? AND target_id=? FOR UPDATE`).get(current.target_type,current.target_id);
      if(!targetRow)throw new HttpError(409,'The appealed moderation target no longer has a current state.');
      const targetState=z.enum(['visible','hidden']).parse(targetRow.state);
      const targetRevision=z.number().int().positive().parse(targetRow.revision);
      if(current.appeal_revision!==parsed.data.revision||targetRevision!==parsed.data.targetRevision)
        throw new HttpError(409,'The appeal or moderation target changed. Review current revisions.');
      if(role!=='administrator'){
        if(current.assigned_to!==null&&current.assigned_to!==user.id)throw new HttpError(409,'Another moderator owns this appeal.');
        if(parsed.data.action!=='claim'&&current.assigned_to!==user.id)throw new HttpError(409,'Claim this appeal before applying an appeal decision.');
      }
      let assigned=current.assigned_to,state=current.state,targetChanged=false;
      if(parsed.data.action==='claim'){
        if(assigned===user.id)throw new HttpError(409,'This appeal is already assigned to you.');
        assigned=user.id;
      }else if(parsed.data.action==='release'){
        if(assigned===null)throw new HttpError(409,'This appeal is already unassigned.');
        if(role!=='administrator'&&assigned!==user.id)throw new HttpError(409,'Only the assigned moderator can release this appeal.');
        assigned=null;
      }else{
        if(state!=='open')throw new HttpError(409,'This appeal already has a final decision.');
        if(targetState!=='hidden'||targetRevision!==current.target_revision)
          throw new HttpError(409,'This appeal no longer matches the current hidden moderation revision.');
        state=parsed.data.action==='deny'?'denied':'upheld';
        if(parsed.data.action==='uphold'){
          const exists=current.target_type==='post'
            ?await this.db.prepare('SELECT id FROM posts WHERE id=? FOR UPDATE').get(current.target_id)
            :await this.db.prepare('SELECT id FROM comments WHERE id=? AND user_id IS NOT NULL FOR UPDATE').get(current.target_id);
          if(!exists)throw new HttpError(409,'The appealed contribution no longer exists.');
          const changed=await this.db.prepare(`UPDATE community_moderation_targets SET state='visible',revision=revision+1,updated_at=?
            WHERE target_type=? AND target_id=? AND revision=? AND state='hidden'`)
            .run(new Date().toISOString(),current.target_type,current.target_id,targetRevision);
          if(changed!==1)throw new HttpError(409,'The moderation target changed before this appeal decision.');
          targetChanged=true;
        }
      }
      const now=new Date().toISOString();
      const changed=await this.db.prepare(`UPDATE community_appeals SET assigned_to=?,state=?,appeal_revision=appeal_revision+1,updated_at=?
        WHERE id=? AND appeal_revision=?`).run(assigned,state,now,current.id,current.appeal_revision);
      if(changed!==1)throw new HttpError(409,'The community appeal changed before this action.');
      await this.db.prepare(`INSERT INTO community_appeal_events
        (id,appeal_id,target_type,target_id,actor_ref,actor_role,action,reason,prior_appeal_revision,result_appeal_revision,
          prior_target_revision,result_target_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),current.id,current.target_type,current.target_id,user.id,role,parsed.data.action,parsed.data.reason,
          current.appeal_revision,current.appeal_revision+1,targetChanged?targetRevision:null,targetChanged?targetRevision+1:null,now);
      const updated=await this.db.prepare(`SELECT appeals.*,target.state AS current_target_state,target.revision AS current_target_revision
        FROM community_appeals appeals LEFT JOIN community_moderation_targets target
          ON target.target_type=appeals.target_type AND target.target_id=appeals.target_id WHERE appeals.id=?`).get(current.id);
      return this.appealDto(updated,user.id);
    });
  }
  async act(user:User,id:unknown,input:unknown):Promise<StaffCommunityReport> {
    const reportId=z.uuid().safeParse(id),parsed=actionInput.safeParse(input);
    if(!reportId.success||!parsed.success)throw new HttpError(400,'Choose one report, current report/target revisions, one supported action and a 20-500 character reason.');
    return this.db.transaction(async()=>{
      const role=await this.authorize(user);
      const raw=await this.db.prepare(`SELECT reports.*,target.state AS target_state,target.revision AS target_revision
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        WHERE reports.id=? FOR UPDATE OF reports`).get(reportId.data);
      if(!raw)throw new HttpError(404,'Community report not found.');
      const current=reportRow.parse(raw);
      await this.lockTarget(current.target_type,current.target_id);
      const targetRow=await this.db.prepare(`SELECT state,revision FROM community_moderation_targets
        WHERE target_type=? AND target_id=? FOR UPDATE`).get(current.target_type,current.target_id);
      const targetState=targetRow?.state===undefined?'visible':z.enum(['visible','hidden']).parse(targetRow.state);
      const targetRevision=targetRow?.revision===undefined?0:z.number().int().positive().parse(targetRow.revision);
      if(current.report_revision!==parsed.data.revision||targetRevision!==parsed.data.targetRevision)
        throw new HttpError(409,'The report or moderation target changed. Review current revisions.');
      if(role!=='administrator'){
        if(current.assigned_to!==null&&current.assigned_to!==user.id)throw new HttpError(409,'Another moderator owns this report.');
        if(!['claim'].includes(parsed.data.action)&&current.assigned_to!==user.id)throw new HttpError(409,'Claim this report before applying a moderation action.');
      }
      let assigned=current.assigned_to,state=current.state,targetChanged=false,nextTarget=targetState;
      if(parsed.data.action==='claim'){
        if(assigned===user.id)throw new HttpError(409,'This report is already assigned to you.');
        assigned=user.id;
      }else if(parsed.data.action==='release'){
        if(assigned===null)throw new HttpError(409,'This report is already unassigned.');
        if(role!=='administrator'&&assigned!==user.id)throw new HttpError(409,'Only the assigned moderator can release this report.');
        assigned=null;
      }else if(parsed.data.action==='dismiss'){
        if(state==='dismissed')throw new HttpError(409,'This report is already dismissed.');
        state='dismissed';
      }else{
        nextTarget=parsed.data.action==='hide'?'hidden':'visible';
        if(nextTarget===targetState)throw new HttpError(409,`This contribution is already ${targetState}.`);
        const exists=current.target_type==='post'
          ?await this.db.prepare('SELECT id FROM posts WHERE id=? FOR UPDATE').get(current.target_id)
          :await this.db.prepare('SELECT id FROM comments WHERE id=? FOR UPDATE').get(current.target_id);
        if(!exists)throw new HttpError(409,'The reported contribution no longer exists.');
        if(targetRevision===0){
          await this.db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
            VALUES(?,?,?,1,?)`).run(current.target_type,current.target_id,nextTarget,new Date().toISOString());
        }else{
          const changed=await this.db.prepare(`UPDATE community_moderation_targets SET state=?,revision=revision+1,updated_at=?
            WHERE target_type=? AND target_id=? AND revision=?`).run(nextTarget,new Date().toISOString(),current.target_type,current.target_id,targetRevision);
          if(changed!==1)throw new HttpError(409,'The moderation target changed before this action.');
        }
        targetChanged=true;state='actioned';
      }
      const now=new Date().toISOString();
      const changed=await this.db.prepare(`UPDATE community_reports SET assigned_to=?,state=?,report_revision=report_revision+1,updated_at=?
        WHERE id=? AND report_revision=?`).run(assigned,state,now,current.id,current.report_revision);
      if(changed!==1)throw new HttpError(409,'The community report changed before this action.');
      await this.db.prepare(`INSERT INTO community_moderation_events
        (id,report_id,target_type,target_id,actor_ref,actor_role,action,reason,prior_report_revision,result_report_revision,
          prior_target_revision,result_target_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),current.id,current.target_type,current.target_id,user.id,role,parsed.data.action,parsed.data.reason,
          current.report_revision,current.report_revision+1,targetChanged?targetRevision:null,targetChanged?targetRevision+1:null,now);
      const updated=await this.db.prepare(`SELECT reports.*,target.state AS target_state,target.revision AS target_revision
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id WHERE reports.id=?`).get(current.id);
      return this.dto(updated,user.id);
    });
  }
}
