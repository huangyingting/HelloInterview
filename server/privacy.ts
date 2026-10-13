import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrivacyDeletionStatus, PrivacyDeletionView, PrivacyExportHistory, PrivacyExportStatus } from '../shared/types';
import { ContentRepository } from './content/repository';
import type { Database, DatabaseRow } from './db/connection';
import { StateRepository } from './db/state-repository';
import { Entitlements } from './entitlements';
import { HttpError } from './http-error';
import { DurableJobs, TerminalJobFailure, type JobClaim } from './jobs';

const requestSchema=z.strictObject({requestId:z.uuid().transform(value=>value.toLowerCase())});
const payloadSchema=z.strictObject({exportId:z.uuid()});
const deletionPayloadSchema=z.strictObject({deletionId:z.uuid()});
const deletionBlockers=[
  'billing-cancellation-unapproved',
  'processor-erasure-unavailable',
  'retention-policy-unapproved',
  'backup-restore-reconciliation-unavailable',
] as const;
const deletionRowSchema=z.object({
  id:z.uuid(),user_id:z.string(),operation_id:z.uuid().nullable(),state:z.enum(['cooling-off','cancelled','blocked']),
  requested_at:z.date(),cancel_before:z.date(),cancelled_at:z.date().nullable(),blocked_at:z.date().nullable(),
  blockers:z.array(z.string()),
});
const rowSchema=z.object({
  id:z.uuid(),user_id:z.string(),operation_id:z.uuid(),state:z.enum(['requested','ready','expired']),
  requested_at:z.date(),ready_at:z.date().nullable(),expires_at:z.date().nullable(),
  artifact:z.string().nullable(),artifact_hash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  artifact_bytes:z.number().int().positive().nullable(),
});
type ExportRow=z.infer<typeof rowSchema>;

function without(row:DatabaseRow,...keys:string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));
}
function parseJson(value:unknown) {
  if(typeof value!=='string')return value;
  try{return JSON.parse(value) as unknown;}catch{return value;}
}
function parsedRows(rows:DatabaseRow[],...keys:string[]) {
  return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,keys.includes(key)?parseJson(value):value])));
}

export class PrivacyExports {
  private constructor(private readonly db:Database,readonly jobs:DurableJobs) {}
  static async open(db:Database,worker=false) {
    if(db.dialect!=='postgres')throw new Error('Durable privacy exports require controlled PostgreSQL.');
    return new PrivacyExports(db,await DurableJobs.open(db,worker));
  }
  close(){return this.jobs.close();}
  private async row(owner:string,id:string) {
    const row=await this.db.prepare('SELECT * FROM privacy_exports WHERE user_id=? AND id=?').get(owner,z.uuid().parse(id));
    if(!row)throw new HttpError(404,'Privacy export not found.');
    return rowSchema.parse(row);
  }
  private async statusFromRow(owner:string,row:ExportRow):Promise<PrivacyExportStatus> {
    const operation=await this.jobs.ownedStatus(owner,row.operation_id);
    const clock=await this.db.prepare('SELECT clock_timestamp() AS now').get();
    const expired=row.expires_at!==null&&row.expires_at.getTime()<=z.date().parse(clock?.now).getTime();
    const status=row.state==='expired'||expired?'expired':row.state==='ready'?'ready':
      operation.status==='active'?'processing':
      ['failed','cancelled','missing','completed'].includes(operation.status)?'failed':'requested';
    return {
      id:row.id,status,requestedAt:row.requested_at.toISOString(),
      readyAt:row.ready_at?.toISOString()??null,expiresAt:row.expires_at?.toISOString()??null,
      bytes:row.artifact_bytes,sha256:row.artifact_hash,
    };
  }
  async request(owner:string,input:unknown,admit:()=>Promise<void>) {
    const {requestId}=requestSchema.parse(input);
    return this.db.transaction(async()=>{
      await admit();
      const operation=await this.jobs.enqueue({
        principal:{type:'user',id:owner},kind:'privacy.process',key:requestId,
        resource:`privacy-export:${requestId}`,payload:{exportId:requestId},retryMode:'idempotent',
      });
      await this.db.prepare(`INSERT INTO privacy_exports(id,user_id,operation_id)
        VALUES(?,?,?) ON CONFLICT(user_id,id) DO NOTHING`).run(requestId,owner,operation.id);
      const row=await this.row(owner,requestId);
      if(row.operation_id!==operation.id)throw new HttpError(409,'This privacy export request ID is already bound to another operation.');
      await admit();
      return this.statusFromRow(owner,row);
    });
  }
  async history(owner:string):Promise<PrivacyExportHistory> {
    const rows=await this.db.prepare('SELECT * FROM privacy_exports WHERE user_id=? ORDER BY requested_at DESC,id DESC LIMIT 10').all(owner);
    return {exports:await Promise.all(rows.map(row=>this.statusFromRow(owner,rowSchema.parse(row))))};
  }
  async expire() {
    return this.db.prepare(`UPDATE privacy_exports SET state='expired',artifact=NULL,artifact_hash=NULL,artifact_bytes=NULL
      WHERE state='ready' AND expires_at<=clock_timestamp()`).run();
  }
  async download(owner:string,id:string) {
    const row=await this.row(owner,id);
    const status=await this.statusFromRow(owner,row);
    if(status.status==='expired')throw new HttpError(410,'This privacy export expired. Request a new export.');
    if(status.status!=='ready'||row.artifact===null)throw new HttpError(409,'This privacy export is not ready to download.');
    if(Buffer.byteLength(row.artifact)!==row.artifact_bytes||
      createHash('sha256').update(row.artifact).digest('hex')!==row.artifact_hash)throw new Error('The saved privacy export failed its integrity check.');
    return {artifact:row.artifact,status};
  }
  private async deletionStatus(owner:string,row:z.infer<typeof deletionRowSchema>,fresh:boolean):Promise<PrivacyDeletionStatus> {
    let status:PrivacyDeletionStatus['status']=row.state;
    if(row.state==='cooling-off'&&row.operation_id){
      const operation=await this.jobs.ownedStatus(owner,row.operation_id);
      status=['created','retry','active'].includes(operation.status)?'processing':'incomplete';
    }
    return {
      id:row.id,status,requestedAt:row.requested_at.toISOString(),cancelBefore:row.cancel_before.toISOString(),
      cancelledAt:row.cancelled_at?.toISOString()??null,blockedAt:row.blocked_at?.toISOString()??null,
      blockers:row.blockers,fresh,
    };
  }
  async deletion(owner:string,fresh:boolean):Promise<PrivacyDeletionView> {
    const row=await this.db.prepare(`SELECT * FROM privacy_deletions WHERE user_id=?
      ORDER BY requested_at DESC,id DESC LIMIT 1`).get(owner);
    return {deletion:row?await this.deletionStatus(owner,deletionRowSchema.parse(row),fresh):null};
  }
  async requestDeletion(owner:string,input:unknown,transition:<T>(mutation:()=>Promise<T>)=>Promise<T>) {
    const {requestId}=requestSchema.parse(input);
    return transition(async()=>{
      const inserted=await this.db.prepare(`INSERT INTO privacy_deletions(id,user_id,requested_at,cancel_before)
        SELECT ?,?,clock.at,clock.at+interval '7 days' FROM (SELECT clock_timestamp() AS at) clock
        ON CONFLICT DO NOTHING RETURNING id`).get(requestId,owner);
      const row=await this.db.prepare('SELECT * FROM privacy_deletions WHERE user_id=? AND id=?').get(owner,requestId);
      if(!row)throw new HttpError(409,'Another account deletion request is already open.');
      const parsed=deletionRowSchema.parse(row);
      if(!inserted&&parsed.state!=='cooling-off')throw new HttpError(409,'This deletion request ID is already terminal.');
      return this.deletionStatus(owner,parsed,true);
    });
  }
  async cancelDeletion(owner:string,input:unknown,transition:<T>(mutation:()=>Promise<T>)=>Promise<T>) {
    const parsed=z.strictObject({requestId:z.uuid()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide the active deletion request ID.');
    return transition(async()=>{
      const changed=await this.db.prepare(`UPDATE privacy_deletions SET state='cancelled',cancelled_at=clock_timestamp()
        WHERE user_id=? AND id=? AND state='cooling-off' AND operation_id IS NULL AND clock_timestamp()<=cancel_before
        RETURNING *`).get(owner,parsed.data.requestId);
      if(!changed)throw new HttpError(409,'The deletion cooling-off period ended or this request is no longer cancellable.');
      return this.deletionStatus(owner,deletionRowSchema.parse(changed),true);
    });
  }
  async enqueueDueDeletion() {
    return this.db.transaction(async()=>{
      const due=await this.db.prepare(`SELECT id,user_id FROM privacy_deletions WHERE state='cooling-off'
        AND operation_id IS NULL AND cancel_before<=clock_timestamp() ORDER BY cancel_before,id
        FOR UPDATE SKIP LOCKED LIMIT 1`).get();
      if(!due)return false;
      const deletionId=z.uuid().parse(due.id),owner=z.string().parse(due.user_id);
      const operation=await this.jobs.enqueue({principal:{type:'user',id:owner},kind:'privacy.delete',key:deletionId,
        resource:`privacy-deletion:${deletionId}`,payload:{deletionId},retryMode:'idempotent'});
      const changed=await this.db.prepare(`UPDATE privacy_deletions SET operation_id=? WHERE user_id=? AND id=?
        AND state='cooling-off' AND operation_id IS NULL`).run(operation.id,owner,deletionId);
      if(changed!==1)throw new Error('A due deletion request changed before its durable operation was bound.');
      return true;
    });
  }
  async runDeletionClaim(claim:JobClaim,signal?:AbortSignal) {
    const operation=await this.jobs.operation(claim.data.operationId);
    if(operation.kind!=='privacy.delete'||operation.principal.type!=='user'||operation.ownerId!==operation.principal.id)
      throw new TerminalJobFailure('not-eligible');
    const {deletionId}=deletionPayloadSchema.parse(operation.payload);
    await this.jobs.finish(claim,async db=>{
      const row=deletionRowSchema.parse(await db.prepare(`SELECT * FROM privacy_deletions
        WHERE user_id=? AND id=? FOR UPDATE`).get(operation.principal.id,deletionId));
      if(row.operation_id!==operation.id||row.state!=='cooling-off')throw new TerminalJobFailure('invalid-result');
      const changed=await db.prepare(`UPDATE privacy_deletions SET state='blocked',blocked_at=clock_timestamp(),blockers=?::jsonb
        WHERE user_id=? AND id=? AND state='cooling-off' AND operation_id=?`).run(
          JSON.stringify(deletionBlockers),operation.principal.id,deletionId,operation.id);
      if(changed!==1)throw new TerminalJobFailure('invalid-result');
      return {deletionId,status:'blocked',blockers:[...deletionBlockers]};
    },signal);
  }
  async runClaim(claim:JobClaim,signal?:AbortSignal) {
    const operation=await this.jobs.operation(claim.data.operationId);
    if(operation.kind!=='privacy.process'||operation.principal.type!=='user'||operation.ownerId!==operation.principal.id)
      throw new TerminalJobFailure('not-eligible');
    const {exportId}=payloadSchema.parse(operation.payload);
    await this.jobs.finish(claim,async db=>{
      const row=rowSchema.parse(await db.prepare('SELECT * FROM privacy_exports WHERE id=? AND user_id=? FOR UPDATE').get(exportId,operation.principal.id));
      if(row.operation_id!==operation.id||row.state!=='requested')throw new TerminalJobFailure('invalid-result');
      const artifact=await this.build(db,operation.principal.id,exportId);
      const bytes=Buffer.byteLength(artifact);
      if(bytes<1||bytes>33554432)throw new TerminalJobFailure('invalid-result');
      const sha256=createHash('sha256').update(artifact).digest('hex');
      const changed=await db.prepare(`UPDATE privacy_exports SET state='ready',ready_at=ready.at,
        expires_at=ready.at+interval '24 hours',artifact=?,artifact_hash=?,artifact_bytes=?
        FROM (SELECT clock_timestamp() AS at) ready WHERE user_id=? AND id=? AND state='requested'`)
        .run(artifact,sha256,bytes,operation.principal.id,exportId);
      if(changed!==1)throw new TerminalJobFailure('invalid-result');
      return {exportId,bytes,sha256,expiresInSeconds:86400};
    },signal);
  }
  private async build(db:Database,owner:string,exportId:string) {
    const user=await db.prepare('SELECT id,name,email,demo,created_at FROM users WHERE id=?').get(owner);
    if(!user)throw new TerminalJobFailure('not-eligible');
    const one=(sql:string,...values:string[])=>db.prepare(sql).get(...values);
    const all=(sql:string,...values:string[])=>db.prepare(sql).all(...values);
    const state=await new StateRepository(db).read(owner);
    const generated=await one('SELECT clock_timestamp() AS now');
    const managed=await one(`SELECT status,contact_email,contact_verified,session_epoch,security_cutoff,admin_revision
      FROM managed_accounts WHERE user_id=?`,owner);
    const customer=await one(`SELECT id,state,created_at FROM stripe_owned_customers WHERE user_id=?`,owner);
    const customerRef=typeof customer?.id==='string'?customer.id:null;
    const artifact={
      format:'interview-studio-owner-export-v1',exportId,generatedAt:z.date().parse(generated?.now).toISOString(),
      account:{
        profile:user,
        managed:managed??null,
        identities:await all(`SELECT id,issuer,subject,provider,email,verified,available,created_at
          FROM managed_identities WHERE user_id=? ORDER BY created_at,id`,owner),
        sessions:await all(`SELECT m.id,m.identity_id,m.epoch,m.authenticated_at,m.mfa_at,m.created_at,m.last_used,s.expires
          FROM managed_sessions m JOIN sessions s ON s.token=m.token WHERE s.user_id=? ORDER BY m.created_at,m.id`,owner),
        securityEvents:await all(`SELECT id,action,identity_id,created_at FROM identity_security_events
          WHERE user_id=? ORDER BY created_at,id`,owner),
        staffRoleEvents:await all(`SELECT id,role,state,starts_at,ends_at,created_at FROM staff_role_events
          WHERE user_id=? ORDER BY created_at,id`,owner),
        deletionRequests:parsedRows(await all(`SELECT id,state,requested_at,cancel_before,cancelled_at,blocked_at,blockers
          FROM privacy_deletions WHERE user_id=? ORDER BY requested_at,id`,owner),'blockers'),
      },
      preparation:{
        state,
        assessmentSessions:await new ContentRepository(db).exportSessions(owner),
        legacySnapshots:parsedRows(await all(`SELECT version,value,checksum,import_fingerprint FROM legacy_state_snapshots
          WHERE user_id=?`,owner),'value'),
      },
      access:{
        current:await new Entitlements(db).view(owner),
        grants:await all(`SELECT id,source_kind,policy,starts_at,ends_at,created_at FROM entitlement_grants
          WHERE user_id=? ORDER BY created_at,id`,owner),
        events:await all(`SELECT id,grant_id,action,source_kind,created_at FROM entitlement_events
          WHERE user_id=? ORDER BY created_at,id`,owner),
      },
      usage:{
        lineages:await all(`SELECT id,anchor,service_start,service_end FROM ai_usage_lineages WHERE owner_ref=? ORDER BY service_start,id`,owner),
        windows:await all(`SELECT w.id,w.lineage_id,w.starts_at,w.ends_at,w.unit_limit,w.reserved,w.consumed,p.payload AS policy
          FROM ai_usage_windows w JOIN ai_usage_policies p ON p.id=w.policy_id WHERE w.owner_ref=? ORDER BY w.starts_at,w.id`,owner),
        reservations:parsedRows(await all(`SELECT id,request_key,request_payload,units,cost_ceiling,state,created_at,dispatched_at,
          finished_at,result_hash,actual_cost FROM ai_usage_reservations WHERE owner_ref=? ORDER BY created_at,id`,owner),'request_payload'),
        events:await all(`SELECT e.id,e.reservation_id,e.action,e.created_at FROM ai_usage_events e
          WHERE e.owner_ref=? ORDER BY e.created_at,e.id`,owner),
        inputs:parsedRows(await all(`SELECT id,request_key,request_payload,kind,source_id,source_revision,payload,created_at
          FROM ai_input_snapshots WHERE owner_ref=? AND user_id=? ORDER BY created_at,id`,owner,owner),'request_payload','payload'),
      },
      community:{
        posts:await all(`SELECT p.id,p.kind,p.title,p.body,p.company,p.track,p.level,p.region,p.author,p.created_at,p.sample,
          r.revision FROM posts p LEFT JOIN community_post_revisions r ON r.post_id=p.id WHERE p.author_id=? ORDER BY p.created_at,p.id`,owner),
        comments:await all(`SELECT c.id,c.resource,c.author,c.body,c.created_at,c.parent_id,r.revision FROM comments c
          LEFT JOIN community_comment_revisions r ON r.comment_id=c.id WHERE c.user_id=? ORDER BY c.created_at,c.id`,owner),
        votes:await all('SELECT post_id FROM votes WHERE user_id=? ORDER BY post_id',owner),
        follows:await all('SELECT post_id FROM follows WHERE user_id=? ORDER BY post_id',owner),
        commentSubmissions:await all(`SELECT request_id,comment_id,resource,created_at FROM community_comment_submissions
          WHERE user_id=? ORDER BY created_at,request_id`,owner),
      },
      support:(await all(`SELECT id,email,body,created_at FROM support WHERE user_id=? ORDER BY created_at,id`,owner)),
      billing:customerRef?{
        customer:without(customer!,'id'),
        checkouts:await all(`SELECT id,request_key,offer_key,state,payment_status,currency,unit_amount,expires_at,created_at,observed_at
          FROM stripe_checkout_attempts WHERE customer_ref=? ORDER BY created_at,id`,customerRef),
        subscriptions:parsedRows(await all(`SELECT id,revision,status,payload FROM stripe_owned_subscription_ledger
          WHERE customer_ref=? ORDER BY revision,id`,customerRef),'payload'),
        invoices:parsedRows(await all(`SELECT id,revision,created_at_seconds,status,payload FROM stripe_owned_invoice_ledger
          WHERE customer_ref=? ORDER BY created_at_seconds,id`,customerRef),'payload'),
        cancellations:await all(`SELECT id,policy_version,subscription_ref,attempt_id,cycle,state,created_at,confirmed_at,result
          FROM stripe_subscription_cancellations WHERE customer_ref=? ORDER BY created_at,id`,customerRef),
        resumptions:await all(`SELECT id,policy_version,subscription_ref,attempt_id,cancellation_id,state,created_at,confirmed_at,result
          FROM stripe_subscription_resumptions WHERE customer_ref=? ORDER BY created_at,id`,customerRef),
      }:null,
      notices:{
        legacyQuiz:'Unversioned legacy quiz answers and scores are preserved in preparation state; original question versions were not recorded.',
        billing:'Billing records are sandbox customer-visible history, not proof of live payment.',
        scope:'This artifact contains Studio-owned records. It does not claim processor deletion, an approved retention schedule, external delivery or account erasure.',
      },
    };
    return JSON.stringify(artifact);
  }
}
