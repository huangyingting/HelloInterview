import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {
  CommunityRestriction,CommunityRestrictionAppealPage,CommunityRestrictionAppealReceipt,
  CommunityRestrictionAppealStatus,CommunityRestrictionScope,CommunityRestrictionStatus,
  StaffCommunityRestriction,StaffCommunityRestrictionAppeal,StaffCommunityRestrictionAppealPage,
  StaffCommunityRestrictionPage,StaffRole,User,
} from '../shared/types';
import type {Database} from './db/connection';
import type {ManagedIdentity} from './identity';
import {HttpError} from './http-error';
import {communityPageCursor} from './community';
import {digest,encodePayload} from './jobs/schema';

const scope=z.enum(['participation','reporting']),duration=z.union([z.literal(24),z.literal(168),z.literal(720)]);
const reason=z.string().trim().min(20).max(500).refine(value=>!value.includes('\0'));
const applyInput=z.strictObject({
  reportRevision:z.number().int().nonnegative(),targetRevision:z.number().int().nonnegative(),
  subject:z.enum(['author','reporter']),scope,durationHours:duration,reason,
}).superRefine((value,context)=>{
  if(value.subject==='author'&&value.scope!=='participation'||value.subject==='reporter'&&value.scope!=='reporting')
    context.addIssue({code:'custom',message:'Restriction subject and scope do not match.'});
});
const changeInput=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('extend'),revision:z.number().int().positive(),durationHours:duration,reason}),
  z.strictObject({action:z.literal('lift'),revision:z.number().int().positive(),reason}),
]);
const restrictionRow=z.object({
  id:z.uuid(),scope,state:z.enum(['active','lifted','expired']),revision:z.number().int().positive(),
  starts_at:z.string(),expires_at:z.string(),updated_at:z.string(),source_report_id:z.uuid(),
  target_type:z.enum(['post','comment']),target_id:z.string(),target_title:z.string().nullable(),
  target_body:z.string(),target_author:z.string(),target_resource:z.string().nullable(),last_actor:z.string(),
});
const memberRow=restrictionRow.pick({
  id:true,scope:true,state:true,revision:true,starts_at:true,expires_at:true,updated_at:true,
});
const queueCursor=z.strictObject({
  version:z.literal('community-restrictions-v1'),hash:z.literal('community-restrictions'),
  updatedAt:z.iso.datetime(),id:z.uuid(),
});
const storedRestrictionRow=z.object({
  id:z.uuid(),subject_id:z.string().nullable(),source_report_id:z.uuid(),scope,
  state:z.enum(['active','lifted','expired']),revision:z.number().int().positive(),
  starts_at:z.string(),expires_at:z.string(),created_at:z.string(),updated_at:z.string(),
});
const appealInput=z.strictObject({
  requestId:z.uuid().transform(value=>value.toLowerCase()),restrictionId:z.uuid(),
  restrictionRevision:z.number().int().positive(),
  statement:z.string().trim().min(20).max(1000).refine(value=>!value.includes('\0')),
});
const appealRow=z.object({
  id:z.uuid(),owner_id:z.string().nullable(),request_key:z.uuid(),input_hash:z.string().length(64),
  restriction_id:z.uuid(),restriction_revision:z.number().int().positive(),statement:z.string(),
  state:z.enum(['open','denied','upheld','resolved']),assigned_to:z.string().nullable(),
  appeal_revision:z.number().int().nonnegative(),created_at:z.string(),updated_at:z.string(),
});
const appealStatusRow=appealRow.extend({
  current_scope:scope,current_state:z.enum(['active','lifted','expired']),
  current_revision:z.number().int().positive(),current_expires_at:z.string(),
});
const staffAppealRow=appealStatusRow.extend({
  target_type:z.enum(['post','comment']),target_id:z.string(),target_title:z.string().nullable(),
  target_body:z.string(),target_author:z.string(),target_resource:z.string().nullable(),
  restriction_actor_ref:z.string(),
});
const appealActionInput=z.strictObject({
  revision:z.number().int().nonnegative(),restrictionRevision:z.number().int().positive(),
  action:z.enum(['claim','release','deny','uphold','resolve']),
  reason:z.string().trim().min(20).max(500).refine(value=>!value.includes('\0')),
});
const appealHistoryCursor=z.strictObject({
  version:z.literal('community-restriction-appeal-history-v1'),hash:z.string().length(64),
  createdAt:z.iso.datetime(),id:z.uuid(),
});
const uuid=(db:Database)=>db.dialect==='postgres'?'?::uuid':'?';
const staffAppealCursor=z.strictObject({
  version:z.literal('community-restriction-appeal-queue-v1'),hash:z.literal('community-restriction-appeals'),
  updatedAt:z.iso.datetime(),id:z.uuid(),
});

export class CommunityRestrictions {
  constructor(private readonly db:Database,private readonly identity:ManagedIdentity|null) {}
  private async clock() {
    const row=await this.db.prepare(this.db.dialect==='postgres'
      ?'SELECT clock_timestamp() AS now'
      :"SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now").get();
    const value=row?.now;
    const parsed=value instanceof Date?value:new Date(z.string().parse(value));
    if(!Number.isFinite(parsed.getTime()))throw new Error('The database clock returned an invalid restriction time.');
    return parsed;
  }
  private async lock(subject:string,value:CommunityRestrictionScope) {
    if(this.db.dialect!=='postgres')return;
    const raw=parseInt(digest(`community-restriction:${subject}:${value}`).slice(0,8),16);
    await this.db.prepare('SELECT pg_advisory_xact_lock(?)').get(raw>2147483647?raw-4294967296:raw);
  }
  private async lockTarget(type:'post'|'comment',id:string) {
    if(this.db.dialect!=='postgres')return;
    const raw=parseInt(digest(`${type}:${id}`).slice(0,8),16);
    await this.db.prepare('SELECT pg_advisory_xact_lock(?)').get(raw>2147483647?raw-4294967296:raw);
  }
  private member(value:unknown):CommunityRestriction {
    const row=memberRow.parse(value);
    return {id:row.id,scope:row.scope,status:row.state,revision:row.revision,
      startsAt:row.starts_at,expiresAt:row.expires_at,updatedAt:row.updated_at};
  }
  private effectiveState(state:'active'|'lifted'|'expired',expiresAt:string,now:string) {
    return state==='active'&&expiresAt<=now?'expired':state;
  }
  private appealReceipt(value:unknown):CommunityRestrictionAppealReceipt {
    const row=appealRow.parse(value);
    return {id:row.id,requestId:row.request_key,restrictionId:row.restriction_id,
      appealedRestrictionRevision:row.restriction_revision,status:'saved',createdAt:row.created_at,
      delivery:'restriction-review-queue-only'};
  }
  private appealStatus(value:unknown,now:string):CommunityRestrictionAppealStatus {
    const row=appealStatusRow.parse(value);
    return {id:row.id,requestId:row.request_key,restrictionId:row.restriction_id,scope:row.current_scope,
      appealedRestrictionRevision:row.restriction_revision,status:row.state,revision:row.appeal_revision,
      restrictionState:this.effectiveState(row.current_state,row.current_expires_at,now),
      restrictionRevision:row.current_revision,expiresAt:row.current_expires_at,
      createdAt:row.created_at,updatedAt:row.updated_at};
  }
  private staff(value:unknown,actor:string):StaffCommunityRestriction {
    const row=restrictionRow.parse(value);
    return {...this.member(row),subject:row.scope==='participation'?'author':'reporter',
      lastActor:row.last_actor===actor?'me':'other',sourceReportId:row.source_report_id,
      targetType:row.target_type,targetId:row.target_id,target:{title:row.target_title,body:row.target_body,
        author:row.target_author,resource:row.target_resource}};
  }
  private async authorize(user:User) {
    if(!this.identity)throw new HttpError(404,'Community restrictions are not configured.');
    await this.identity.assertStaff(user);
    const roles=await this.identity.staffRoles(user.id),role=roles.find(value=>value==='moderator'||value==='administrator');
    if(!role)throw new HttpError(403,'Your current staff role does not permit community restrictions.');
    return role as Extract<StaffRole,'moderator'|'administrator'>;
  }
  private select() {
    return `SELECT restriction.*,
      report.target_type,report.target_id,
      CASE WHEN report.target_type='post' THEN (SELECT title FROM posts WHERE id=report.target_id) ELSE NULL END AS target_title,
      COALESCE(CASE WHEN report.target_type='post' THEN (SELECT body FROM posts WHERE id=report.target_id)
        ELSE (SELECT body FROM comments WHERE id=report.target_id) END,'Contribution unavailable') AS target_body,
      COALESCE(CASE WHEN report.target_type='post' THEN (SELECT CASE WHEN kind='questions' THEN 'Anonymous' ELSE author END FROM posts WHERE id=report.target_id)
        ELSE (SELECT author FROM comments WHERE id=report.target_id) END,'Unavailable') AS target_author,
      CASE WHEN report.target_type='comment' THEN (SELECT resource FROM comments WHERE id=report.target_id) ELSE NULL END AS target_resource,
      (SELECT actor_ref FROM community_restriction_events event WHERE event.restriction_id=restriction.id
        ORDER BY event.created_at DESC,event.id DESC LIMIT 1) AS last_actor
      FROM community_restrictions restriction JOIN community_reports report ON report.id=restriction.source_report_id`;
  }
  private async current(id:string,actor:string) {
    return this.staff(await this.db.prepare(`${this.select()} WHERE restriction.id=?`).get(id),actor);
  }
  private async evidence(input:{
    restrictionId:string;reportId:string;actor:string;role:Extract<StaffRole,'moderator'|'administrator'>;
    action:'restrict'|'extend'|'lift'|'expire';reason:string;priorRevision:number;resultRevision:number;
    priorExpires:string|null;resultExpires:string;resultState:'active'|'lifted'|'expired';createdAt:string;
  }) {
    await this.db.prepare(`INSERT INTO community_restriction_events
      (id,restriction_id,source_report_id,actor_ref,actor_role,action,reason,prior_revision,result_revision,
        prior_expires_at,result_expires_at,result_state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(),input.restrictionId,input.reportId,input.actor,input.role,input.action,input.reason,
        input.priorRevision,input.resultRevision,input.priorExpires,input.resultExpires,input.resultState,input.createdAt);
  }
  async assertAllowed(owner:string,value:CommunityRestrictionScope) {
    return this.db.transaction(async()=>{
      await this.lock(owner,value);
      const blocked=await this.db.prepare(`SELECT id FROM community_restrictions
        WHERE subject_id=? AND scope=? AND state='active' AND expires_at>? LIMIT 1`)
        .get(owner,value,(await this.clock()).toISOString());
      if(blocked)throw new HttpError(403,value==='reporting'
        ?'Community report submission is temporarily restricted. Existing status, appeals and personal safety controls remain available.'
        :'Community participation is temporarily restricted. Reading, deletion, reports, appeals and personal safety controls remain available.');
    });
  }
  async status(user:User):Promise<CommunityRestrictionStatus> {
    const now=(await this.clock()).toISOString();
    const rows=await this.db.prepare(`SELECT id,scope,state,revision,starts_at,expires_at,updated_at
      FROM community_restrictions WHERE subject_id=? AND state='active' AND expires_at>?
      ORDER BY expires_at,id LIMIT 3`).all(user.id,now);
    return {restrictions:rows.map(value=>this.member(value))};
  }
  async appeal(user:User,input:unknown,admit:()=>Promise<void>):Promise<CommunityRestrictionAppealReceipt> {
    const parsed=appealInput.safeParse(input);
    if(!parsed.success)throw new HttpError(400,
      'Provide one current restriction, its positive revision, a UUID request key and a 20-1,000 character appeal statement.');
    const request=parsed.data,{requestId:_,...content}=request,hash=digest(encodePayload({owner:user.id,...content}));
    return this.db.transaction(async()=>{
      await admit();
      const existing=await this.db.prepare(`SELECT * FROM community_restriction_appeals
        WHERE owner_id=? AND request_key=${uuid(this.db)}`).get(user.id,request.requestId);
      if(existing){
        if(existing.input_hash!==hash)throw new HttpError(409,'This restriction appeal key belongs to different appeal content.');
        await admit();return this.appealReceipt(existing);
      }
      const seed=storedRestrictionRow.safeParse(await this.db.prepare(`SELECT * FROM community_restrictions
        WHERE id=${uuid(this.db)} AND subject_id=?`).get(request.restrictionId,user.id));
      if(!seed.success)throw new HttpError(404,'This community restriction is unavailable for an owner appeal.');
      await this.lock(user.id,seed.data.scope);
      const concurrent=await this.db.prepare(`SELECT * FROM community_restriction_appeals
        WHERE owner_id=? AND request_key=${uuid(this.db)}`).get(user.id,request.requestId);
      if(concurrent){
        if(concurrent.input_hash!==hash)throw new HttpError(409,'This restriction appeal key belongs to different appeal content.');
        await admit();return this.appealReceipt(concurrent);
      }
      const now=(await this.clock()).toISOString();
      const current=storedRestrictionRow.safeParse(await this.db.prepare(`SELECT * FROM community_restrictions
        WHERE id=${uuid(this.db)} AND subject_id=?${this.db.dialect==='postgres'?' FOR UPDATE':''}`)
        .get(request.restrictionId,user.id));
      if(!current.success||current.data.state!=='active'||current.data.expires_at<=now||
        current.data.revision!==request.restrictionRevision)
        throw new HttpError(409,'Appeal the current active restriction revision after reloading your moderation status.');
      if(await this.db.prepare(`SELECT id FROM community_restriction_appeals
        WHERE owner_id=? AND restriction_id=${uuid(this.db)} AND restriction_revision=?`)
        .get(user.id,request.restrictionId,request.restrictionRevision))
        throw new HttpError(409,'You already appealed this restriction revision.');
      const count=await this.db.prepare(`SELECT count(*) AS count FROM community_restriction_appeals
        WHERE owner_id=? AND state='open'`).get(user.id);
      if(Number(count?.count)>=20)throw new HttpError(409,'Resolve existing restriction appeals before submitting another.');
      const id=randomUUID();
      await this.db.prepare(`INSERT INTO community_restriction_appeals
        (id,owner_id,request_key,input_hash,restriction_id,restriction_revision,statement,created_at,updated_at)
        VALUES(${uuid(this.db)},?,${uuid(this.db)},?,${uuid(this.db)},?,?,?,?)`).run(id,user.id,request.requestId,hash,request.restrictionId,
          request.restrictionRevision,request.statement,now,now);
      const saved=await this.db.prepare(`SELECT * FROM community_restriction_appeals WHERE id=${uuid(this.db)}`).get(id);
      if(!saved)throw new Error('The admitted restriction appeal was not found.');
      await admit();return this.appealReceipt(saved);
    });
  }
  async appealHistory(user:User,input:unknown,admit:()=>Promise<void>):Promise<CommunityRestrictionAppealPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional restriction-appeal history cursor.');
    const hash=digest(`community-restriction-appeal-history:${user.id}`);
    let cursor:z.infer<typeof appealHistoryCursor>|undefined;
    if(parsed.data.cursor)cursor=communityPageCursor(parsed.data.cursor,appealHistoryCursor,hash);
    return this.db.transaction(async()=>{
      await admit();
      const rows=await this.db.prepare(`SELECT appeals.*,restriction.scope AS current_scope,
        restriction.state AS current_state,restriction.revision AS current_revision,
        restriction.expires_at AS current_expires_at
        FROM community_restriction_appeals appeals JOIN community_restrictions restriction
          ON restriction.id=appeals.restriction_id
        WHERE appeals.owner_id=? ${cursor?'AND (appeals.created_at,appeals.id)<(?,?)':''}
        ORDER BY appeals.created_at DESC,appeals.id DESC LIMIT 21`)
        .all(user.id,...(cursor?[cursor.createdAt,cursor.id]:[]));
      const page=rows.slice(0,20),last=page.at(-1)&&appealStatusRow.parse(page.at(-1)),
        now=(await this.clock()).toISOString();
      await admit();
      return {appeals:page.map(value=>this.appealStatus(value,now)),nextCursor:rows.length>20&&last
        ?Buffer.from(JSON.stringify({version:'community-restriction-appeal-history-v1',hash,
          createdAt:last.created_at,id:last.id})).toString('base64url'):null};
    });
  }
  async apply(user:User,id:unknown,input:unknown):Promise<StaffCommunityRestriction> {
    const reportId=z.uuid().safeParse(id),parsed=applyInput.safeParse(input);
    if(!reportId.success||!parsed.success)throw new HttpError(400,
      'Choose one current report/target revision, its author participation or reporter reporting scope, a fixed expiry and a 20-500 character reason.');
    return this.db.transaction(async()=>{
      const role=await this.authorize(user);
      const report=await this.db.prepare(`SELECT reports.* FROM community_reports reports
        WHERE reports.id=? ${this.db.dialect==='postgres'?'FOR UPDATE OF reports':''}`).get(reportId.data);
      if(!report)throw new HttpError(404,'Community report not found.');
      const reportRevision=z.number().int().nonnegative().parse(report.report_revision);
      const reportTargetType=z.enum(['post','comment']).parse(report.target_type),reportTargetId=z.string().parse(report.target_id);
      await this.lockTarget(reportTargetType,reportTargetId);
      const target=await this.db.prepare(`SELECT revision FROM community_moderation_targets
        WHERE target_type=? AND target_id=? ${this.db.dialect==='postgres'?'FOR UPDATE':''}`).get(reportTargetType,reportTargetId);
      const targetRevision=target?.revision===null||target?.revision===undefined?0:z.number().int().positive().parse(target.revision);
      if(reportRevision!==parsed.data.reportRevision||targetRevision!==parsed.data.targetRevision)
        throw new HttpError(409,'The report or moderation target changed. Review current revisions.');
      if(report.state==='dismissed')throw new HttpError(409,'A dismissed report cannot issue a community restriction.');
      if(role!=='administrator'&&report.assigned_to!==user.id)
        throw new HttpError(409,'Claim this report before applying a community restriction.');
      let subject:string|undefined;
      if(parsed.data.subject==='reporter')subject=typeof report.reporter_id==='string'?report.reporter_id:undefined;
      else if(reportTargetType==='post')subject=z.string().optional().parse((await this.db.prepare(
        'SELECT author_id FROM posts WHERE id=? AND sample=0').get(reportTargetId))?.author_id);
      else subject=z.string().optional().parse((await this.db.prepare(
        'SELECT user_id FROM comments WHERE id=? AND user_id IS NOT NULL').get(reportTargetId))?.user_id);
      if(!subject||!await this.db.prepare('SELECT id FROM users WHERE id=?').get(subject))
        throw new HttpError(409,'The selected report subject no longer has a restrictable account.');
      if(subject===user.id)throw new HttpError(409,'Staff cannot restrict their own community account.');
      if((await this.identity!.staffRoles(subject)).length)
        throw new HttpError(409,'Another staff account requires the separate reviewed staff-access procedure.');
      await this.lock(subject,parsed.data.scope);
      if(!await this.db.prepare(`SELECT id FROM users WHERE id=?${this.db.dialect==='postgres'?' FOR UPDATE':''}`).get(subject))
        throw new HttpError(409,'The selected report subject no longer has a restrictable account.');
      const now=await this.clock(),nowText=now.toISOString();
      const current=await this.db.prepare(`SELECT * FROM community_restrictions
        WHERE subject_id=? AND scope=? AND state='active' ${this.db.dialect==='postgres'?'FOR UPDATE':''}`)
        .get(subject,parsed.data.scope);
      if(current&&Date.parse(z.string().parse(current.expires_at))>now.getTime())
        throw new HttpError(409,'This account already has an active restriction in that scope. Review the current restriction.');
      if(current){
        const currentId=z.uuid().parse(current.id),prior=z.number().int().positive().parse(current.revision),
          expires=z.string().parse(current.expires_at);
        await this.db.prepare(`UPDATE community_restrictions SET state='expired',revision=revision+1,updated_at=?
          WHERE id=? AND revision=?`).run(nowText,currentId,prior);
        await this.evidence({restrictionId:currentId,reportId:z.uuid().parse(current.source_report_id),
          actor:user.id,role,action:'expire',reason:'The stored restriction expiry was reached before this separately reviewed action.',
          priorRevision:prior,resultRevision:prior+1,priorExpires:expires,resultExpires:expires,resultState:'expired',createdAt:nowText});
      }
      const restrictionId=randomUUID(),expires=new Date(now.getTime()+parsed.data.durationHours*3600000).toISOString();
      await this.db.prepare(`INSERT INTO community_restrictions
        (id,subject_id,source_report_id,scope,state,revision,starts_at,expires_at,created_at,updated_at)
        VALUES(?,?,?,?,'active',1,?,?,?,?)`)
        .run(restrictionId,subject,reportId.data,parsed.data.scope,nowText,expires,nowText,nowText);
      await this.evidence({restrictionId,reportId:reportId.data,actor:user.id,role,action:'restrict',reason:parsed.data.reason,
        priorRevision:0,resultRevision:1,priorExpires:null,resultExpires:expires,resultState:'active',createdAt:nowText});
      return this.current(restrictionId,user.id);
    });
  }
  async change(user:User,id:unknown,input:unknown):Promise<StaffCommunityRestriction> {
    const restrictionId=z.uuid().safeParse(id),parsed=changeInput.safeParse(input);
    if(!restrictionId.success||!parsed.success)throw new HttpError(400,
      'Choose one current restriction revision, extend or lift, any required fixed expiry, and a 20-500 character reason.');
    return this.db.transaction(async()=>{
      const role=await this.authorize(user);
      let raw=await this.db.prepare(`SELECT restriction.*,
        (SELECT actor_ref FROM community_restriction_events event WHERE event.restriction_id=restriction.id
          ORDER BY event.created_at DESC,event.id DESC LIMIT 1) AS last_actor
        FROM community_restrictions restriction WHERE restriction.id=?`).get(restrictionId.data);
      if(!raw)throw new HttpError(404,'Community restriction not found.');
      const subject=z.string().nullable().parse(raw.subject_id);
      if(!subject)throw new HttpError(409,'This restriction subject has been retired.');
      await this.lock(subject,scope.parse(raw.scope));
      raw=await this.db.prepare(`SELECT restriction.*,
        (SELECT actor_ref FROM community_restriction_events event WHERE event.restriction_id=restriction.id
          ORDER BY event.created_at DESC,event.id DESC LIMIT 1) AS last_actor
        FROM community_restrictions restriction WHERE restriction.id=?
        ${this.db.dialect==='postgres'?'FOR UPDATE OF restriction':''}`).get(restrictionId.data);
      if(!raw)throw new HttpError(404,'Community restriction not found.');
      if(raw.subject_id!==subject)throw new HttpError(409,'This restriction subject has been retired.');
      if(Number(raw.revision)!==parsed.data.revision)throw new HttpError(409,'The community restriction changed. Review its current revision.');
      if(raw.state!=='active')throw new HttpError(409,'This community restriction is no longer active.');
      const now=await this.clock(),expires=z.string().parse(raw.expires_at);
      if(Date.parse(expires)<=now.getTime())throw new HttpError(409,'This community restriction has expired. Review a current report before issuing another.');
      if(role!=='administrator'&&raw.last_actor!==user.id)
        throw new HttpError(409,'Only the latest restricting moderator or an administrator can change this restriction.');
      const revision=z.number().int().positive().parse(raw.revision),nowText=now.toISOString();
      let resultExpires=expires,resultState:'active'|'lifted'='lifted';
      if(parsed.data.action==='extend'){
        resultExpires=new Date(now.getTime()+parsed.data.durationHours*3600000).toISOString();resultState='active';
        if(Date.parse(resultExpires)<=Date.parse(expires))
          throw new HttpError(409,'Choose an extension that lasts beyond the current restriction expiry.');
      }
      const changed=await this.db.prepare(`UPDATE community_restrictions SET state=?,revision=revision+1,expires_at=?,updated_at=?
        WHERE id=? AND revision=? AND state='active'`).run(resultState,resultExpires,nowText,restrictionId.data,revision);
      if(changed!==1)throw new HttpError(409,'The community restriction changed before this action.');
      await this.evidence({restrictionId:restrictionId.data,reportId:z.uuid().parse(raw.source_report_id),actor:user.id,role,
        action:parsed.data.action,reason:parsed.data.reason,priorRevision:revision,resultRevision:revision+1,
        priorExpires:expires,resultExpires,resultState,createdAt:nowText});
      return this.current(restrictionId.data,user.id);
    });
  }
  private staffAppealSelect() {
    return `SELECT appeals.*,restriction.scope AS current_scope,restriction.state AS current_state,
      restriction.revision AS current_revision,restriction.expires_at AS current_expires_at,
      report.target_type,report.target_id,
      CASE WHEN report.target_type='post' THEN (SELECT title FROM posts WHERE id=report.target_id) ELSE NULL END AS target_title,
      COALESCE(CASE WHEN report.target_type='post' THEN (SELECT body FROM posts WHERE id=report.target_id)
        ELSE (SELECT body FROM comments WHERE id=report.target_id) END,'Contribution unavailable') AS target_body,
      COALESCE(CASE WHEN report.target_type='post' THEN
        (SELECT CASE WHEN kind='questions' THEN 'Anonymous' ELSE author END FROM posts WHERE id=report.target_id)
        ELSE (SELECT author FROM comments WHERE id=report.target_id) END,'Unavailable') AS target_author,
      CASE WHEN report.target_type='comment' THEN (SELECT resource FROM comments WHERE id=report.target_id) ELSE NULL END AS target_resource,
      (SELECT event.actor_ref FROM community_restriction_events event
        WHERE event.restriction_id=restriction.id ORDER BY event.result_revision DESC LIMIT 1) AS restriction_actor_ref
      FROM community_restriction_appeals appeals
      JOIN community_restrictions restriction ON restriction.id=appeals.restriction_id
      JOIN community_reports report ON report.id=restriction.source_report_id`;
  }
  private staffAppeal(value:unknown,actor:string,now:string):StaffCommunityRestrictionAppeal {
    const row=staffAppealRow.parse(value);
    return {id:row.id,restrictionId:row.restriction_id,scope:row.current_scope,statement:row.statement,
      appealedRestrictionRevision:row.restriction_revision,status:row.state,revision:row.appeal_revision,
      assignment:row.assigned_to===null?null:row.assigned_to===actor?'me':'other',
      restrictionActor:row.restriction_actor_ref===actor?'me':'other',
      restrictionState:this.effectiveState(row.current_state,row.current_expires_at,now),
      restrictionRevision:row.current_revision,expiresAt:row.current_expires_at,
      targetType:row.target_type,targetId:row.target_id,createdAt:row.created_at,updatedAt:row.updated_at,
      target:{title:row.target_title,body:row.target_body,author:row.target_author,resource:row.target_resource}};
  }
  async appealQueue(user:User,input:unknown):Promise<StaffCommunityRestrictionAppealPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional restriction-appeal queue cursor.');
    let cursor:z.infer<typeof staffAppealCursor>|undefined;
    if(parsed.data.cursor)cursor=communityPageCursor(parsed.data.cursor,staffAppealCursor,'community-restriction-appeals');
    return this.db.transaction(async()=>{
      await this.authorize(user);
      const rows=await this.db.prepare(`${this.staffAppealSelect()}
        ${cursor?'WHERE (appeals.updated_at,appeals.id)<(?,?)':''}
        ORDER BY appeals.updated_at DESC,appeals.id DESC LIMIT 21`).all(...(cursor?[cursor.updatedAt,cursor.id]:[]));
      const page=rows.slice(0,20),now=(await this.clock()).toISOString(),
        appeals=page.map(value=>this.staffAppeal(value,user.id,now)),
        last=page.at(-1)&&staffAppealRow.parse(page.at(-1));
      await this.authorize(user);
      return {appeals,nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({
        version:'community-restriction-appeal-queue-v1',hash:'community-restriction-appeals',
        updatedAt:last.updated_at,id:last.id})).toString('base64url'):null};
    });
  }
  async actOnAppeal(user:User,id:unknown,input:unknown):Promise<StaffCommunityRestrictionAppeal> {
    const appealId=z.uuid().safeParse(id),parsed=appealActionInput.safeParse(input);
    if(!appealId.success||!parsed.success)throw new HttpError(400,
      'Choose one restriction appeal, current appeal/restriction revisions, one supported action and a 20-500 character reason.');
    return this.db.transaction(async()=>{
      const role=await this.authorize(user);
      const seedAppeal=appealRow.safeParse(await this.db.prepare('SELECT * FROM community_restriction_appeals WHERE id=?')
        .get(appealId.data));
      if(!seedAppeal.success)throw new HttpError(404,'Community restriction appeal not found.');
      const seedRestriction=storedRestrictionRow.safeParse(await this.db.prepare('SELECT * FROM community_restrictions WHERE id=?')
        .get(seedAppeal.data.restriction_id));
      if(!seedRestriction.success)throw new HttpError(409,'The appealed restriction is no longer stored.');
      if(seedRestriction.data.subject_id)await this.lock(seedRestriction.data.subject_id,seedRestriction.data.scope);
      const currentRestriction=storedRestrictionRow.safeParse(await this.db.prepare(`SELECT * FROM community_restrictions
        WHERE id=?${this.db.dialect==='postgres'?' FOR UPDATE':''}`).get(seedAppeal.data.restriction_id));
      if(!currentRestriction.success)throw new HttpError(409,'The appealed restriction is no longer stored.');
      const restriction=currentRestriction.data;
      const raw=await this.db.prepare(`${this.staffAppealSelect()} WHERE appeals.id=?
        ${this.db.dialect==='postgres'?'FOR UPDATE OF appeals':''}`).get(appealId.data);
      if(!raw)throw new HttpError(404,'Community restriction appeal not found.');
      const current=staffAppealRow.parse(raw),now=(await this.clock()).toISOString();
      if(current.appeal_revision!==parsed.data.revision||restriction.revision!==parsed.data.restrictionRevision)
        throw new HttpError(409,'The restriction appeal or restriction changed. Review current revisions.');
      if(role!=='administrator'){
        if(current.assigned_to!==null&&current.assigned_to!==user.id)
          throw new HttpError(409,'Another moderator owns this restriction appeal.');
        if(parsed.data.action!=='claim'&&current.assigned_to!==user.id)
          throw new HttpError(409,'Claim this restriction appeal before applying a review action.');
      }
      let assigned=current.assigned_to,state=current.state,resultRestrictionRevision:number|null=null;
      const exactCurrent=restriction.subject_id!==null&&restriction.state==='active'&&restriction.expires_at>now&&
        restriction.revision===current.restriction_revision;
      if(parsed.data.action==='claim'){
        if(state!=='open')throw new HttpError(409,'This restriction appeal already has a final decision.');
        if(assigned===user.id)throw new HttpError(409,'This restriction appeal is already assigned to you.');
        assigned=user.id;
      }else if(parsed.data.action==='release'){
        if(state!=='open')throw new HttpError(409,'This restriction appeal already has a final decision.');
        if(assigned===null)throw new HttpError(409,'This restriction appeal is already unassigned.');
        if(role!=='administrator'&&assigned!==user.id)
          throw new HttpError(409,'Only the assigned moderator can release this restriction appeal.');
        assigned=null;
      }else{
        if(state!=='open')throw new HttpError(409,'This restriction appeal already has a final decision.');
        if(role!=='administrator'&&current.restriction_actor_ref===user.id)
          throw new HttpError(409,'A different moderator or an administrator must decide this restriction appeal.');
        if(parsed.data.action==='resolve'){
          if(exactCurrent)throw new HttpError(409,'A current restriction appeal requires an uphold or deny decision.');
          state='resolved';
        }else{
          if(!exactCurrent)
            throw new HttpError(409,'This appeal no longer matches the current active restriction revision; resolve it after review.');
          state=parsed.data.action==='deny'?'denied':'upheld';
          if(parsed.data.action==='uphold'){
            const changed=await this.db.prepare(`UPDATE community_restrictions
              SET state='lifted',revision=revision+1,updated_at=?
              WHERE id=? AND revision=? AND state='active'`).run(now,restriction.id,restriction.revision);
            if(changed!==1)throw new HttpError(409,'The restriction changed before this appeal decision.');
            resultRestrictionRevision=restriction.revision+1;
            await this.evidence({restrictionId:restriction.id,reportId:restriction.source_report_id,actor:user.id,role,
              action:'lift',reason:parsed.data.reason,priorRevision:restriction.revision,
              resultRevision:resultRestrictionRevision,priorExpires:restriction.expires_at,
              resultExpires:restriction.expires_at,resultState:'lifted',createdAt:now});
          }
        }
      }
      const changed=await this.db.prepare(`UPDATE community_restriction_appeals
        SET assigned_to=?,state=?,appeal_revision=appeal_revision+1,updated_at=?
        WHERE id=? AND appeal_revision=?`).run(assigned,state,now,current.id,current.appeal_revision);
      if(changed!==1)throw new HttpError(409,'The restriction appeal changed before this action.');
      await this.db.prepare(`INSERT INTO community_restriction_appeal_events
        (id,appeal_id,restriction_id,actor_ref,actor_role,action,reason,prior_appeal_revision,result_appeal_revision,
          prior_restriction_revision,result_restriction_revision,result_appeal_state,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),current.id,restriction.id,user.id,role,parsed.data.action,
          parsed.data.reason,current.appeal_revision,current.appeal_revision+1,restriction.revision,
          resultRestrictionRevision,state,now);
      const updated=await this.db.prepare(`${this.staffAppealSelect()} WHERE appeals.id=?`).get(current.id);
      return this.staffAppeal(updated,user.id,now);
    });
  }
  async queue(user:User,input:unknown):Promise<StaffCommunityRestrictionPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional community-restriction cursor.');
    let cursor:z.infer<typeof queueCursor>|undefined;
    if(parsed.data.cursor)cursor=communityPageCursor(parsed.data.cursor,queueCursor,'community-restrictions');
    return this.db.transaction(async()=>{
      await this.authorize(user);
      const now=(await this.clock()).toISOString();
      const rows=await this.db.prepare(`${this.select()} WHERE restriction.state='active' AND restriction.expires_at>?
        ${cursor?'AND (restriction.updated_at,restriction.id)<(?,?)':''}
        ORDER BY restriction.updated_at DESC,restriction.id DESC LIMIT 21`)
        .all(now,...(cursor?[cursor.updatedAt,cursor.id]:[]));
      const page=rows.slice(0,20),restrictions=page.map(value=>this.staff(value,user.id));
      const last=restrictions.at(-1);
      await this.authorize(user);
      return {restrictions,nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({
        version:'community-restrictions-v1',hash:'community-restrictions',updatedAt:last.updatedAt,id:last.id,
      })).toString('base64url'):null};
    });
  }
}
