import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {
  CommunityRestriction,CommunityRestrictionScope,CommunityRestrictionStatus,StaffCommunityRestriction,
  StaffCommunityRestrictionPage,StaffRole,User,
} from '../shared/types';
import type {Database} from './db/connection';
import type {ManagedIdentity} from './identity';
import {HttpError} from './http-error';
import {communityPageCursor} from './community';
import {digest} from './jobs/schema';

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
