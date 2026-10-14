import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {
  CommunityAppealReceipt,CommunityAppealStatus,CommunityAppealStatusPage,CommunityReportReceipt,
  CommunityReportStatus,CommunityReportStatusPage,StaffCommunityAppeal,StaffCommunityAppealPage,
  CommunitySpamTriageSignal,StaffCommunityReport,StaffCommunityReportPage,StaffRole,User,
} from '../shared/types';
import type {Database} from './db/connection';
import type {ManagedIdentity} from './identity';
import {HttpError} from './http-error';
import {communityIdentifierSchema,communityPageCursor} from './community';
import {digest,encodePayload} from './jobs/schema';
import {classifyCommunitySpam,communitySpamTriageVersion} from './community-spam-triage';

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
const booleanRow=z.union([z.boolean(),z.literal(0),z.literal(1)]).transform(Boolean);
const staffReportRow=reportRow.extend({
  triage_algorithm_version:z.string().nullable(),triage_input_truncated:z.union([booleanRow,z.null()]),
  triage_content_revision:z.number().int().nullable(),
  triage_score:z.number().int().nullable(),triage_classification:z.enum(['unlikely-spam','uncertain','likely-spam']).nullable(),
  triage_link_count:z.number().int().nullable(),triage_contact_solicitation:z.union([booleanRow,z.null()]),
  triage_promotional_language:z.union([booleanRow,z.null()]),triage_repetitive_content:z.union([booleanRow,z.null()]),
  triage_state:z.enum(['pending','reviewed']).nullable(),triage_outcome:z.enum(['confirmed','rejected']).nullable(),
  triage_revision:z.number().int().nullable(),triage_created_at:z.string().nullable(),triage_updated_at:z.string().nullable(),
});
const staffReportProjection=`reports.*,target.state AS target_state,target.revision AS target_revision,
  triage.algorithm_version AS triage_algorithm_version,triage.input_truncated AS triage_input_truncated,
  triage.content_revision AS triage_content_revision,
  triage.score AS triage_score,triage.classification AS triage_classification,triage.link_count AS triage_link_count,
  triage.contact_solicitation AS triage_contact_solicitation,
  triage.promotional_language AS triage_promotional_language,triage.repetitive_content AS triage_repetitive_content,
  triage.state AS triage_state,triage.outcome AS triage_outcome,triage.revision AS triage_revision,
  triage.created_at AS triage_created_at,triage.updated_at AS triage_updated_at`;
const staffCursor=z.strictObject({version:z.literal('community-moderation-v1'),hash:z.literal('community-moderation'),updatedAt:z.iso.datetime(),id:z.uuid()});
const actionInput=z.strictObject({
  revision:z.number().int().nonnegative(),targetRevision:z.number().int().nonnegative(),
  action:z.enum(['claim','release','dismiss','hide','restore']),
  reason:z.string().trim().min(20).max(500).refine(value=>!value.includes('\0')),
});
const triageReviewInput=z.strictObject({
  revision:z.number().int().nonnegative(),decision:z.enum(['confirmed','rejected']),
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
const uuid=(db:Database)=>db.dialect==='postgres'?'?::uuid':'?';
const boolean=(db:Database)=>db.dialect==='postgres'?'?::boolean':'?';
const flag=(db:Database,value:boolean)=>db.dialect==='postgres'?String(value):Number(value);

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
  private async recordSpamTriage(reportId:string,type:'post'|'comment',targetId:string,reportCategory:z.infer<typeof category>) {
    const target=type==='post'
      ?await this.db.prepare(`SELECT posts.title,posts.body,revisions.revision AS content_revision FROM posts
        JOIN community_post_revisions revisions ON revisions.post_id=posts.id WHERE posts.id=?`).get(targetId)
      :await this.db.prepare(`SELECT NULL AS title,comments.body,revisions.revision AS content_revision FROM comments
        JOIN community_comment_revisions revisions ON revisions.comment_id=comments.id WHERE comments.id=?`).get(targetId);
    if(!target)throw new Error('The reported contribution disappeared before spam triage was recorded.');
    const contentRevision=z.number().int().nonnegative().parse(target.content_revision);
    const snapshot=classifyCommunitySpam({
      title:z.string().nullable().parse(target.title),body:z.string().parse(target.body),category:reportCategory,contentRevision,
    }),now=new Date().toISOString();
    await this.db.prepare(`INSERT INTO community_spam_triage
      (report_id,algorithm_version,input_hash,content_revision,input_truncated,score,classification,link_count,
        contact_solicitation,promotional_language,repetitive_content,state,outcome,revision,created_at,updated_at)
      VALUES(${uuid(this.db)},?,?,?,${boolean(this.db)},?,?,?,${boolean(this.db)},${boolean(this.db)},${boolean(this.db)},'pending',NULL,0,?,?)`)
      .run(reportId,snapshot.algorithmVersion,snapshot.inputHash,contentRevision,flag(this.db,snapshot.inputTruncated),snapshot.score,
        snapshot.classification,snapshot.linkCount,flag(this.db,snapshot.contactSolicitation),flag(this.db,snapshot.promotionalLanguage),
        flag(this.db,snapshot.repetitiveContent),now,now);
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
        WHERE reports.reporter_id=? AND reports.request_key=${uuid(this.db)}`).get(user.id,request.requestId);
      if(existing){
        if(existing.input_hash!==hash)throw new HttpError(409,'This community report key belongs to different report content.');
        await admit();
        return this.receipt(existing);
      }
      await this.lockTarget(request.targetType,request.targetId);
      const concurrent=await this.db.prepare(`SELECT reports.*,target.state AS target_state,target.revision AS target_revision
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        WHERE reports.reporter_id=? AND reports.request_key=${uuid(this.db)}`).get(user.id,request.requestId);
      if(concurrent){
        if(concurrent.input_hash!==hash)throw new HttpError(409,'This community report key belongs to different report content.');
        await admit();
        return this.receipt(concurrent);
      }
      if(!await this.targetExists(request.targetType,request.targetId,true,true))throw new HttpError(404,'This community contribution is unavailable for reporting.');
      const muted=request.targetType==='post'
        ?await this.db.prepare(`SELECT mute.id FROM posts p JOIN community_mutes mute
          ON mute.owner_id=? AND mute.subject_id=p.author_id AND mute.state='muted' WHERE p.id=?`).get(user.id,request.targetId)
        :await this.db.prepare(`SELECT mute.id FROM comments JOIN community_mutes mute
          ON mute.owner_id=? AND mute.subject_id=comments.user_id AND mute.state='muted' WHERE comments.id=?`).get(user.id,request.targetId);
      if(muted)throw new HttpError(404,'This community contribution is unavailable for reporting.');
      const duplicate=await this.db.prepare(`SELECT id FROM community_reports WHERE reporter_id=? AND target_type=? AND target_id=? AND state='open'`).get(
        user.id,request.targetType,request.targetId);
      if(duplicate)throw new HttpError(409,'You already have an open report for this contribution.');
      const count=await this.db.prepare(`SELECT count(*) AS count FROM community_reports WHERE reporter_id=? AND state='open'`).get(user.id);
      if(Number(count?.count)>=20)throw new HttpError(409,'Resolve existing community reports before submitting another.');
      const id=randomUUID(),now=new Date().toISOString();
      await this.db.prepare(`INSERT INTO community_reports
        (id,reporter_id,request_key,input_hash,target_type,target_id,category,details,created_at,updated_at)
        VALUES(${uuid(this.db)},?,${uuid(this.db)},?,?,?,?,?,?,?)`).run(id,user.id,request.requestId,hash,request.targetType,request.targetId,request.category,request.details,now,now);
      await this.recordSpamTriage(id,request.targetType,request.targetId,request.category);
      const saved=await this.db.prepare(`SELECT reports.*,NULL AS target_state,NULL AS target_revision FROM community_reports reports WHERE id=${uuid(this.db)}`).get(id);
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
      const existing=await this.db.prepare(`${select} WHERE appeals.owner_id=? AND appeals.request_key=${uuid(this.db)}`).get(user.id,request.requestId);
      if(existing){
        if(existing.input_hash!==hash)throw new HttpError(409,'This community appeal key belongs to different appeal content.');
        await admit();return this.appealReceipt(existing);
      }
      await this.lockTarget(request.targetType,request.targetId);
      const concurrent=await this.db.prepare(`${select} WHERE appeals.owner_id=? AND appeals.request_key=${uuid(this.db)}`).get(user.id,request.requestId);
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
        VALUES(${uuid(this.db)},?,${uuid(this.db)},?,?,?,?,?,?,?)`)
        .run(id,user.id,request.requestId,hash,request.targetType,request.targetId,request.targetRevision,request.statement,now,now);
      const saved=await this.db.prepare(`${select} WHERE appeals.id=${uuid(this.db)}`).get(id);
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
        NULL AS resource,revisions.revision AS content_revision FROM posts
        JOIN community_post_revisions revisions ON revisions.post_id=posts.id WHERE posts.id=?`).get(id);
      if(!row)return {title:'Contribution unavailable',body:'The reported post is no longer stored.',author:'Unavailable',
        resource:null,contentRevision:null};
      return {title:z.string().parse(row.title),body:z.string().parse(row.body),author:z.string().parse(row.author),
        resource:null,contentRevision:z.number().int().nonnegative().parse(row.content_revision)};
    }
    const row=await this.db.prepare(`SELECT NULL AS title,comments.body,comments.author,comments.resource,
      revisions.revision AS content_revision FROM comments
      JOIN community_comment_revisions revisions ON revisions.comment_id=comments.id WHERE comments.id=?`).get(id);
    if(!row)return {title:null,body:'The reported comment is no longer stored.',author:'Unavailable',
      resource:null,contentRevision:null};
    return {title:null,body:z.string().parse(row.body),author:z.string().parse(row.author),
      resource:z.string().parse(row.resource),contentRevision:z.number().int().nonnegative().parse(row.content_revision)};
  }
  private async dto(value:unknown,actor:string):Promise<StaffCommunityReport> {
    const row=staffReportRow.parse(value),signals:CommunitySpamTriageSignal[]=[];
    if(row.triage_link_count!==null&&row.triage_link_count>=2)signals.push('multiple-links');
    if(row.triage_contact_solicitation)signals.push('contact-solicitation');
    if(row.triage_promotional_language)signals.push('promotional-language');
    if(row.triage_repetitive_content)signals.push('repetitive-content');
    if(row.triage_input_truncated)signals.push('input-truncated');
    const triage=row.triage_algorithm_version===null?null:{
      algorithmVersion:z.literal(communitySpamTriageVersion).parse(row.triage_algorithm_version),
      classification:z.enum(['unlikely-spam','uncertain','likely-spam']).parse(row.triage_classification),
      score:z.number().int().min(0).max(100).parse(row.triage_score),signals,
      contentRevision:z.number().int().nonnegative().parse(row.triage_content_revision),
      state:z.enum(['pending','reviewed']).parse(row.triage_state),revision:z.number().int().nonnegative().parse(row.triage_revision),
      outcome:z.enum(['confirmed','rejected']).nullable().parse(row.triage_outcome),
      createdAt:z.string().parse(row.triage_created_at),updatedAt:z.string().parse(row.triage_updated_at),
    };
    return {id:row.id,targetType:row.target_type,targetId:row.target_id,category:row.category,details:row.details,
      status:row.state,revision:row.report_revision,assignment:row.assigned_to===null?null:row.assigned_to===actor?'me':'other',
      targetState:row.target_state??'visible',targetRevision:row.target_revision??0,createdAt:row.created_at,updatedAt:row.updated_at,
      triage,target:await this.target(row.target_type,row.target_id)};
  }
  async queue(user:User,input:unknown):Promise<StaffCommunityReportPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional moderation queue cursor.');
    let cursor:z.infer<typeof staffCursor>|undefined;
    if(parsed.data.cursor)cursor=communityPageCursor(parsed.data.cursor,staffCursor,'community-moderation');
    return this.db.transaction(async()=>{
      await this.authorize(user);
      const rows=await this.db.prepare(`SELECT ${staffReportProjection}
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        LEFT JOIN community_spam_triage triage ON triage.report_id=reports.id
        ${cursor?'WHERE (reports.updated_at,reports.id)<(?,?)':''}
        ORDER BY reports.updated_at DESC,reports.id DESC LIMIT 21`).all(...(cursor?[cursor.updatedAt,cursor.id]:[]));
      const page=rows.slice(0,20),reports:StaffCommunityReport[]=[];
      for(const row of page)reports.push(await this.dto(row,user.id));
      const last=page.at(-1)&&reportRow.parse(page.at(-1));
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
      const updated=await this.db.prepare(`SELECT ${staffReportProjection}
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        LEFT JOIN community_spam_triage triage ON triage.report_id=reports.id WHERE reports.id=?`).get(current.id);
      return this.dto(updated,user.id);
    });
  }
  async reviewTriage(user:User,id:unknown,input:unknown):Promise<StaffCommunityReport> {
    const reportId=z.uuid().safeParse(id),parsed=triageReviewInput.safeParse(input);
    if(!reportId.success||!parsed.success)
      throw new HttpError(400,'Choose one report, its current triage revision, confirm or reject, and a 20-500 character reason.');
    return this.db.transaction(async()=>{
      const role=await this.authorize(user);
      const report=await this.db.prepare(`SELECT assigned_to,target_type,target_id FROM community_reports WHERE id=?
        ${this.db.dialect==='postgres'?'FOR UPDATE':''}`).get(reportId.data);
      if(!report)throw new HttpError(404,'Community report not found.');
      if(role!=='administrator'&&report.assigned_to!==user.id)
        throw new HttpError(409,'Claim this report before reviewing its automated spam suggestion.');
      const current=await this.db.prepare(`SELECT content_revision,state,outcome,revision FROM community_spam_triage WHERE report_id=?
        ${this.db.dialect==='postgres'?'FOR UPDATE':''}`).get(reportId.data);
      if(!current)throw new HttpError(409,'This pre-migration report has no spam triage snapshot to review.');
      if(current.state!=='pending'||Number(current.revision)!==parsed.data.revision)
        throw new HttpError(409,'This spam triage suggestion changed. Review its current state.');
      const type=targetType.parse(report.target_type),targetId=communityIdentifierSchema.parse(report.target_id);
      const target=type==='post'
        ?await this.db.prepare(`SELECT revisions.revision AS content_revision FROM posts
          JOIN community_post_revisions revisions ON revisions.post_id=posts.id WHERE posts.id=?
          ${this.db.dialect==='postgres'?'FOR UPDATE OF posts':''}`).get(targetId)
        :await this.db.prepare(`SELECT revisions.revision AS content_revision FROM comments
          JOIN community_comment_revisions revisions ON revisions.comment_id=comments.id WHERE comments.id=?
          ${this.db.dialect==='postgres'?'FOR UPDATE OF comments':''}`).get(targetId);
      const contentRevision=target?.content_revision===undefined?null:z.number().int().nonnegative().parse(target.content_revision);
      if(parsed.data.decision==='confirmed'&&contentRevision!==Number(current.content_revision))
        throw new HttpError(409,'The contribution changed after this suggestion. Reject the stale suggestion instead of confirming it.');
      const now=new Date().toISOString();
      const changed=await this.db.prepare(`UPDATE community_spam_triage
        SET state='reviewed',outcome=?,revision=revision+1,updated_at=?
        WHERE report_id=? AND state='pending' AND revision=?`)
        .run(parsed.data.decision,now,reportId.data,parsed.data.revision);
      if(changed!==1)throw new HttpError(409,'This spam triage suggestion changed before the review was saved.');
      await this.db.prepare(`INSERT INTO community_spam_triage_events
        (id,report_id,actor_ref,actor_role,decision,reason,prior_revision,result_revision,created_at)
        VALUES(?,?,?,?,?,?,0,1,?)`)
        .run(randomUUID(),reportId.data,user.id,role,parsed.data.decision,parsed.data.reason,now);
      const updated=await this.db.prepare(`SELECT ${staffReportProjection}
        FROM community_reports reports LEFT JOIN community_moderation_targets target
          ON target.target_type=reports.target_type AND target.target_id=reports.target_id
        LEFT JOIN community_spam_triage triage ON triage.report_id=reports.id WHERE reports.id=?`).get(reportId.data);
      return this.dto(updated,user.id);
    });
  }
}
