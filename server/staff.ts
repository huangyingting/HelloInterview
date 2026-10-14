import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {StaffAccount,StaffAuditEvent,StaffAuditPage,StaffRole,User} from '../shared/types';
import type {Database} from './db/connection';
import {HttpError} from './http-error';

export interface StaffIdentityAuthority {
  assertDatabase(db:Database):void;
  assertStaff(user:User):Promise<void>;
  staffRoles(owner:string):Promise<StaffRole[]>;
}

export const staffRoleSchema=z.enum(['support-agent','moderator','content-editor','billing-operator','administrator']);
const allRoles=staffRoleSchema.options;
const reasonSchema=z.string().trim().min(20).max(500).refine(value=>!value.includes('\0'));
const emailSchema=z.string().trim().min(5).max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const statusSchema=z.enum(['pending-verification','active','suspended','deletion-pending']);
const auditCursorSchema=z.strictObject({version:z.literal('staff-audit-v1'),createdAt:z.string().min(1).max(64).refine(value=>Number.isFinite(Date.parse(value))),id:z.uuid()});

function maskEmail(value:string|null) {
  if(!value)return 'No verified contact';
  const split=value.lastIndexOf('@');
  if(split<1)return 'Masked contact';
  const local=value.slice(0,split),domain=value.slice(split+1);
  return `${local[0]}${'*'.repeat(Math.min(6,Math.max(2,local.length-1)))}@${domain}`;
}
function account(row:Record<string,unknown>):StaffAccount {
  const parsed=z.object({user_id:z.uuid(),contact_email:z.string().nullable(),contact_verified:z.number().int().min(0).max(1),
    status:statusSchema,admin_revision:z.number().int().nonnegative(),active_sessions:z.coerce.number().int().nonnegative()}).parse(row);
  return {id:parsed.user_id,maskedEmail:maskEmail(parsed.contact_email),status:parsed.status,verified:parsed.contact_verified===1,
    revision:parsed.admin_revision,activeSessions:parsed.active_sessions};
}
function audit(row:Record<string,unknown>):StaffAuditEvent {
  const parsed=z.object({id:z.uuid(),actor_ref:z.string(),actor_role:staffRoleSchema.nullable(),target_ref:z.string(),
    action:z.enum(['staff.role.granted','staff.role.revoked','account.suspended','account.reactivated']),reason:reasonSchema,
    prior_revision:z.number().int().nullable(),result_revision:z.number().int().nullable(),created_at:z.date()}).parse(row);
  return {id:parsed.id,actorRef:parsed.actor_ref,actorRole:parsed.actor_role,targetRef:parsed.target_ref,action:parsed.action,
    reason:parsed.reason,priorRevision:parsed.prior_revision,resultRevision:parsed.result_revision,createdAt:parsed.created_at.toISOString()};
}

export class StaffAdministration {
  constructor(private readonly db:Database,private readonly identity:StaffIdentityAuthority) {
    if(db.dialect!=='postgres')throw new Error('Staff administration requires controlled PostgreSQL.');
    identity.assertDatabase(db);
  }
  async roles(owner:string){return this.identity.staffRoles(z.uuid().parse(owner));}
  private async authorize(user:User,allowed:readonly StaffRole[]) {
    await this.identity.assertStaff(user);
    const roles=await this.identity.staffRoles(user.id),role=roles.find(value=>allowed.includes(value));
    if(!role)throw new HttpError(403,'Your current staff role does not permit this operation.');
    return {role,roles};
  }
  async session(user:User) {
    return this.db.transaction(async()=>{const value=await this.authorize(user,allRoles);return {roles:value.roles,mfa:true,fresh:true};});
  }
  async lookup(user:User,input:unknown) {
    const parsed=z.strictObject({email:emailSchema}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only one exact contact email.');
    return this.db.transaction(async()=>{
      await this.authorize(user,['support-agent','administrator']);
      const rows=await this.db.prepare(`SELECT a.user_id,a.contact_email,a.contact_verified,a.status,a.admin_revision,
        (SELECT count(*)::integer FROM sessions s JOIN managed_sessions m ON m.token=s.token
          WHERE s.user_id=a.user_id AND s.expires>floor(extract(epoch from clock_timestamp())*1000)
            AND m.last_used>floor(extract(epoch from clock_timestamp())*1000)-604800000 AND m.epoch=a.session_epoch) AS active_sessions
        FROM managed_accounts a WHERE lower(a.contact_email)=lower(?) ORDER BY a.user_id LIMIT 11`).all(parsed.data.email);
      if(rows.length>10)throw new HttpError(409,'More than ten accounts share this contact. Use the reviewed recovery procedure; no result was returned.');
      return {accounts:rows.map(row=>account(row))};
    });
  }
  async changeStatus(user:User,target:unknown,input:unknown) {
    const owner=z.uuid().safeParse(target),parsed=z.strictObject({status:z.enum(['active','suspended']),revision:z.number().int().nonnegative(),reason:reasonSchema}).safeParse(input);
    if(!owner.success||!parsed.success)throw new HttpError(400,'Choose one account, its current revision, active or suspended status, and a 20-500 character reason.');
    if(owner.data===user.id)throw new HttpError(409,'Staff cannot change their own account status.');
    return this.db.transaction(async()=>{
      const {role}=await this.authorize(user,['administrator']);
      const targetRow=await this.db.prepare('SELECT user_id,contact_email,contact_verified,status,admin_revision FROM managed_accounts WHERE user_id=? FOR UPDATE').get(owner.data);
      if(!targetRow)throw new HttpError(404,'Managed account not found.');
      if((await this.identity.staffRoles(owner.data)).length)throw new HttpError(409,'Another staff account requires the separate reviewed staff-access procedure.');
      const current=statusSchema.parse(targetRow.status),next=parsed.data.status;
      if(current==='deletion-pending'||current==='pending-verification'&&next==='active'||next==='active'&&targetRow.contact_verified!==1)
        throw new HttpError(409,'This account state cannot be changed through staff suspension controls.');
      if(Number(targetRow.admin_revision)!==parsed.data.revision)throw new HttpError(409,'The account changed. Review its current revision before applying a staff action.');
      if(current===next)throw new HttpError(409,'The account already has this status; no audit event was created.');
      const result=await this.db.prepare(`UPDATE managed_accounts SET status=?,admin_revision=admin_revision+1,session_epoch=session_epoch+1
        WHERE user_id=? AND admin_revision=? RETURNING user_id,contact_email,contact_verified,status,admin_revision`).get(next,owner.data,parsed.data.revision);
      if(!result)throw new HttpError(409,'The account changed before this action was applied.');
      await this.db.prepare(`INSERT INTO staff_audit_events
        (id,actor_ref,actor_role,target_ref,action,reason,prior_revision,result_revision) VALUES(?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),user.id,role,owner.data,next==='suspended'?'account.suspended':'account.reactivated',parsed.data.reason,parsed.data.revision,parsed.data.revision+1);
      const sessions=await this.db.prepare(`SELECT count(*)::integer AS active_sessions FROM sessions s JOIN managed_sessions m ON m.token=s.token
        WHERE s.user_id=? AND m.epoch=(SELECT session_epoch FROM managed_accounts WHERE user_id=?)`).get(owner.data,owner.data);
      return account({...result,active_sessions:sessions?.active_sessions??0});
    });
  }
  async history(user:User,input:unknown):Promise<StaffAuditPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional staff audit cursor.');
    let cursor:z.infer<typeof auditCursorSchema>|undefined;
    if(parsed.data.cursor){
      const bytes=Buffer.from(parsed.data.cursor,'base64url');
      if(bytes.toString('base64url')!==parsed.data.cursor)throw new HttpError(400,'Invalid staff audit cursor.');
      try{cursor=auditCursorSchema.parse(JSON.parse(bytes.toString('utf8')));}
      catch(error){if(error instanceof SyntaxError||error instanceof z.ZodError)throw new HttpError(400,'Invalid staff audit cursor.');throw error;}
    }
    return this.db.transaction(async()=>{
      await this.authorize(user,['administrator']);
      const rows=await this.db.prepare(`SELECT *,created_at::text AS cursor_created_at FROM staff_audit_events ${cursor?'WHERE (created_at,id)<(?,?)':''}
        ORDER BY created_at DESC,id DESC LIMIT 21`).all(...(cursor?[cursor.createdAt,cursor.id]:[]));
      const page=rows.slice(0,20),events=page.map(row=>audit(row));
      const last=page.at(-1)&&z.object({id:z.uuid(),cursor_created_at:z.string()}).parse(page.at(-1));
      return {events,nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({version:'staff-audit-v1',createdAt:last.cursor_created_at,id:last.id})).toString('base64url'):null};
    });
  }
}

export async function appendStaffRole(db:Database,input:{userId:string;role:string;state:string;actorRef:string;reason:string;endsAt?:string}) {
  if(db.dialect!=='postgres')throw new Error('Staff role provisioning requires controlled PostgreSQL.');
  const parsed=z.strictObject({userId:z.uuid(),role:staffRoleSchema,state:z.enum(['granted','revoked']),actorRef:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/),
    reason:reasonSchema,endsAt:z.iso.datetime().optional()}).parse(input);
  return db.transaction(async()=>{
    if(!await db.prepare('SELECT user_id FROM managed_accounts WHERE user_id=? FOR UPDATE').get(parsed.userId))throw new Error('Managed staff account not found.');
    const clock=z.object({now:z.date()}).parse(await db.prepare('SELECT clock_timestamp() AS now').get());
    const now=clock.now.getTime(),ends=parsed.endsAt?Date.parse(parsed.endsAt):0;
    if(parsed.state==='granted'&&(!parsed.endsAt||ends<=now||ends>now+90*86400000))throw new Error('A staff grant needs a future expiry no more than 90 days away.');
    if(parsed.state==='revoked'&&parsed.endsAt)throw new Error('A staff revocation cannot include an expiry.');
    const latest=await db.prepare(`SELECT state,ends_at>clock_timestamp() AS unexpired FROM staff_role_events
      WHERE user_id=? AND role=? ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`).get(parsed.userId,parsed.role);
    if(parsed.state==='granted'&&latest?.state==='granted'&&latest.unexpired===true)throw new Error('Staff role is already granted.');
    if(parsed.state==='revoked'&&(latest?.state!=='granted'||latest.unexpired!==true))throw new Error('Staff role is not currently active.');
    const id=randomUUID(),action=parsed.state==='granted'?'staff.role.granted':'staff.role.revoked';
    await db.prepare(`INSERT INTO staff_role_events(id,user_id,role,state,actor_ref,reason,ends_at)
      VALUES(?,?,?,?,?,?,?)`).run(id,parsed.userId,parsed.role,parsed.state,parsed.actorRef,parsed.reason,parsed.endsAt??null);
    await db.prepare(`INSERT INTO staff_audit_events(id,actor_ref,actor_role,target_ref,action,reason)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(),parsed.actorRef,null,parsed.userId,action,parsed.reason);
    return {id,userId:parsed.userId,role:parsed.role,state:parsed.state,endsAt:parsed.endsAt??null};
  });
}
