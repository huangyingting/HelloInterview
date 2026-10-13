import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { StaffRole, StaffSupportPage, StaffSupportTicket, SupportHistory, SupportReceipt, SupportReply, User } from '../shared/types';
import type { Database } from './db/connection';
import type { ManagedIdentity } from './identity';
import { HttpError } from './http-error';
import { digest, encodePayload } from './jobs/schema';

const emailSchema = z.string().min(5).max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const bodySchema = z.string().min(20).max(10000).refine(value => !value.includes('\0'));
const contactSchema = z.strictObject({ email: z.string().trim().pipe(emailSchema), body: z.string().max(10000).trim().pipe(bodySchema) });
export const supportRequestSchema = contactSchema.extend({ key: z.uuid().transform(key => key.toLowerCase()) });
export const supportContactSchema = contactSchema;
const identifier = z.string().min(1).max(200);
const rowSchema = z.object({ id: identifier, email: emailSchema, body: bodySchema,
  user_id:z.string().nullable(),
  created_at: z.iso.datetime(), request_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  handling_status:z.enum(['open','pending','resolved']),support_revision:z.number().int().nonnegative(),
  assigned_to:z.string().nullable(),support_updated_at:z.date(),
});
const cursorSchema = z.strictObject({ owner: identifier, id: identifier, createdAt: z.iso.datetime() });
const staffCursorSchema=z.strictObject({version:z.literal('support-staff-v1'),updatedAt:z.iso.datetime(),id:identifier});
const reasonSchema=z.string().trim().min(20).max(500).refine(value=>!value.includes('\0'));
const replySchema=z.strictObject({requestId:z.uuid().transform(value=>value.toLowerCase()),revision:z.number().int().nonnegative(),
  body:z.string().trim().min(1).max(10000).refine(value=>!value.includes('\0'))});
const updateSchema=z.strictObject({revision:z.number().int().nonnegative(),assignment:z.enum(['me','none']).optional(),
  status:z.enum(['open','pending','resolved']).optional(),reason:reasonSchema})
  .refine(value=>(value.assignment!==undefined)!==(value.status!==undefined));
const replyRowSchema=z.object({id:z.uuid(),body:z.string(),created_at:z.date()});

function reply(value:unknown):SupportReply {
  const row=replyRowSchema.parse(value);return {id:row.id,body:row.body,createdAt:row.created_at.toISOString()};
}
async function receipt(db:Database,value: unknown): Promise<SupportReceipt> {
  const row = rowSchema.parse(value);
  const replies=(await db.prepare('SELECT id,body,created_at FROM support_replies WHERE ticket_id=? ORDER BY created_at,id LIMIT 50').all(row.id)).map(reply);
  return { id: row.id, email: row.email, body: row.body, createdAt: row.created_at, status: 'saved', delivery: 'not-connected',
    handlingStatus:row.handling_status,replies };
}
function maskEmail(value:string) {
  const split=value.lastIndexOf('@'),local=value.slice(0,split),domain=value.slice(split+1);
  return `${local[0]}${'*'.repeat(Math.min(6,Math.max(2,local.length-1)))}@${domain}`;
}

export class SupportRequests {
  constructor(private readonly db: Database, private readonly identity: ManagedIdentity) {
    if (db.dialect !== 'postgres') throw new Error('Managed support receipts require controlled PostgreSQL.');
    identity.assertDatabase(db);
  }
  async save(user: User, input: unknown) {
    const parsed = supportRequestSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'Provide a unique request key, valid contact email and 20-10,000 characters of support text.');
    const request = parsed.data, hash = digest(encodePayload({ owner: user.id, request }));
    return this.db.transaction(async () => {
      await this.identity.assertSupport(user);
      try{
        await this.db.prepare(`INSERT INTO support(id,user_id,email,body,created_at,request_key,request_hash)
          VALUES(?,?,?,?,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),?,?)
          ON CONFLICT(user_id,request_key) WHERE request_key IS NOT NULL DO NOTHING`)
          .run(randomUUID(), user.id, request.email, request.body, request.key, hash);
      }catch(error){
        if(error instanceof Error&&error.message.includes('Support tickets allow only ownership retirement'))
          throw new HttpError(409,'The saved support request changed during admission; no receipt was published.');
        throw error;
      }
      const row = rowSchema.parse(await this.db.prepare('SELECT * FROM support WHERE user_id=? AND request_key=?').get(user.id, request.key));
      if (row.request_hash !== hash || row.email !== request.email || row.body !== request.body) {
        throw new HttpError(409, 'This support request key already belongs to different saved content; no replacement was made.');
      }
      await this.identity.assertSupport(user);
      return receipt(this.db,row);
    });
  }
  async history(user: User, input: unknown): Promise<SupportHistory> {
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (input !== undefined) {
      if (typeof input !== 'string' || input.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(input)) throw new HttpError(400, 'Invalid owned support cursor.');
      const bytes = Buffer.from(input, 'base64url');
      if (bytes.toString('base64url') !== input) throw new HttpError(400, 'Invalid owned support cursor.');
      let payload: unknown;
      try { payload = JSON.parse(bytes.toString('utf8')); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; throw new HttpError(400, 'Invalid owned support cursor.'); }
      const parsed = cursorSchema.safeParse(payload);
      if (!parsed.success || parsed.data.owner !== user.id) throw new HttpError(400, 'Invalid owned support cursor.');
      cursor = parsed.data;
    }
    return this.db.transaction(async () => {
      await this.identity.assertSupport(user);
      const rows = await this.db.prepare(`SELECT * FROM support WHERE user_id=?
        ${cursor ? 'AND (created_at,id)<(?,?)' : ''} ORDER BY created_at DESC,id DESC LIMIT 11`)
        .all(user.id, ...(cursor ? [cursor.createdAt, cursor.id] : []));
      const tickets:SupportReceipt[]=[];
      for(const row of rows.slice(0,10))tickets.push(await receipt(this.db,row));
      const last = tickets.at(-1);
      const nextCursor = rows.length > 10 && last ? Buffer.from(JSON.stringify({ owner: user.id, id: last.id, createdAt: last.createdAt })).toString('base64url') : null;
      await this.identity.assertSupport(user);
      return { tickets, nextCursor, delivery: 'not-connected' };
    });
  }
  private async authorize(user:User) {
    await this.identity.assertStaff(user);
    const roles=await this.identity.staffRoles(user.id),role=roles.find(value=>value==='support-agent'||value==='administrator');
    if(!role)throw new HttpError(403,'Your current staff role does not permit support operations.');
    return role as Extract<StaffRole,'support-agent'|'administrator'>;
  }
  private ticket(value:unknown,actor:string):StaffSupportTicket {
    const row=rowSchema.parse(value);
    return {id:row.id,maskedEmail:maskEmail(row.email),body:row.body,createdAt:row.created_at,
      updatedAt:row.support_updated_at.toISOString(),status:row.handling_status,revision:row.support_revision,
      assignment:row.assigned_to===null?null:row.assigned_to===actor?'me':'other',ownerAccess:row.user_id!==null};
  }
  private async staffRow(id:string) {
    const row=await this.db.prepare('SELECT * FROM support WHERE id=? FOR UPDATE').get(id);
    if(!row)throw new HttpError(404,'Support ticket not found.');
    return rowSchema.parse(row);
  }
  async queue(user:User,input:unknown):Promise<StaffSupportPage> {
    const parsed=z.strictObject({cursor:z.string().max(2048).optional()}).safeParse(input);
    if(!parsed.success)throw new HttpError(400,'Provide only an optional support queue cursor.');
    let cursor:z.infer<typeof staffCursorSchema>|undefined;
    if(parsed.data.cursor){
      const bytes=Buffer.from(parsed.data.cursor,'base64url');
      if(bytes.toString('base64url')!==parsed.data.cursor)throw new HttpError(400,'Invalid support queue cursor.');
      try{cursor=staffCursorSchema.parse(JSON.parse(bytes.toString('utf8')));}
      catch(error){if(error instanceof SyntaxError||error instanceof z.ZodError)throw new HttpError(400,'Invalid support queue cursor.');throw error;}
    }
    return this.db.transaction(async()=>{
      await this.authorize(user);
      const rows=await this.db.prepare(`SELECT * FROM support ${cursor?'WHERE (support_updated_at,id)<(?,?)':''}
        ORDER BY support_updated_at DESC,id DESC LIMIT 21`).all(...(cursor?[cursor.updatedAt,cursor.id]:[]));
      const page=rows.slice(0,20),tickets=page.map(row=>this.ticket(row,user.id)),last=page.at(-1)&&rowSchema.parse(page.at(-1));
      await this.authorize(user);
      return {tickets,nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({version:'support-staff-v1',
        updatedAt:last.support_updated_at.toISOString(),id:last.id})).toString('base64url'):null,delivery:'in-app-only'};
    });
  }
  async update(user:User,id:unknown,input:unknown) {
    const ticketId=identifier.safeParse(id),parsed=updateSchema.safeParse(input);
    if(!ticketId.success||!parsed.success)throw new HttpError(400,'Choose one ticket, its current revision, a state or assignment change, and a 20-500 character reason.');
    return this.db.transaction(async()=>{
      const role=await this.authorize(user);
      const current=await this.staffRow(ticketId.data);
      if(current.support_revision!==parsed.data.revision)throw new HttpError(409,'The support ticket changed. Review its current revision.');
      const assigned=parsed.data.assignment==='me'?user.id:parsed.data.assignment==='none'?null:current.assigned_to;
      const status=parsed.data.status??current.handling_status;
      if(assigned===current.assigned_to&&status===current.handling_status)throw new HttpError(409,'The requested support state is already current.');
      if(role!=='administrator'){
        if(current.assigned_to!==null&&current.assigned_to!==user.id)
          throw new HttpError(409,'Another support agent owns this ticket. An administrator must review reassignment.');
        if(parsed.data.status!==undefined&&current.assigned_to!==user.id)
          throw new HttpError(409,'Assign this ticket to yourself before changing its handling status.');
        if(parsed.data.assignment==='none'&&current.assigned_to!==user.id)
          throw new HttpError(409,'Only the assigned support agent can release this ticket.');
      }
      const changed=rowSchema.parse(await this.db.prepare(`UPDATE support SET assigned_to=?,handling_status=?,
        support_revision=support_revision+1,support_updated_at=clock_timestamp() WHERE id=? AND support_revision=? RETURNING *`)
        .get(assigned,status,ticketId.data,parsed.data.revision));
      const action=assigned!==current.assigned_to?(assigned===null?'unassigned':'assigned'):`status.${status}`;
      await this.db.prepare(`INSERT INTO support_staff_events
        (id,ticket_id,actor_ref,actor_role,action,reason,prior_revision,result_revision) VALUES(?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),ticketId.data,user.id,role,action,parsed.data.reason,parsed.data.revision,parsed.data.revision+1);
      return this.ticket(changed,user.id);
    });
  }
  async respond(user:User,id:unknown,input:unknown) {
    const ticketId=identifier.safeParse(id),parsed=replySchema.safeParse(input);
    if(!ticketId.success||!parsed.success)throw new HttpError(400,'Choose one ticket, its current revision, a UUID request key and a 1-10,000 character reply.');
    return this.db.transaction(async()=>{
      const role=await this.authorize(user),current=await this.staffRow(ticketId.data);
      const hash=digest(encodePayload({ticketId:ticketId.data,body:parsed.data.body}));
      const prior=await this.db.prepare('SELECT id,request_hash,actor_ref,body,created_at FROM support_replies WHERE ticket_id=? AND request_key=?').get(ticketId.data,parsed.data.requestId);
      if(prior){
        if(prior.request_hash!==hash||prior.actor_ref!==user.id||prior.body!==parsed.data.body)
          throw new HttpError(409,'This support reply key is already bound to another reply.');
        return {reply:reply(prior),ticket:this.ticket(current,user.id)};
      }
      if(current.support_revision!==parsed.data.revision)throw new HttpError(409,'The support ticket changed. Review its current revision before replying.');
      if(current.user_id===null)throw new HttpError(409,'This request has no authenticated owner inbox. External delivery is not connected.');
      if(current.assigned_to!==null&&current.assigned_to!==user.id&&role!=='administrator')throw new HttpError(409,'Another support agent owns this ticket.');
      const count=await this.db.prepare('SELECT count(*)::integer AS count FROM support_replies WHERE ticket_id=?').get(ticketId.data);
      if(Number(count?.count)>=50)throw new HttpError(409,'This ticket reached its in-app reply limit. Escalate through the reviewed support procedure.');
      const id=randomUUID();
      await this.db.prepare(`INSERT INTO support_replies(id,ticket_id,request_key,request_hash,actor_ref,body)
        VALUES(?,?,?,?,?,?) ON CONFLICT(ticket_id,request_key) DO NOTHING`).run(id,ticketId.data,parsed.data.requestId,hash,user.id,parsed.data.body);
      const saved=await this.db.prepare('SELECT id,request_hash,actor_ref,body,created_at FROM support_replies WHERE ticket_id=? AND request_key=?').get(ticketId.data,parsed.data.requestId);
      if(!saved||saved.request_hash!==hash||saved.actor_ref!==user.id||saved.body!==parsed.data.body)
        throw new HttpError(409,'This support reply key is already bound to another reply.');
      if(saved.id!==id)return {reply:reply(saved),ticket:this.ticket(current,user.id)};
      const changed=await this.db.prepare(`UPDATE support SET assigned_to=COALESCE(assigned_to,?),handling_status='pending',
        support_revision=support_revision+1,support_updated_at=clock_timestamp() WHERE id=? AND support_revision=?`).run(user.id,ticketId.data,parsed.data.revision);
      if(changed!==1)throw new HttpError(409,'The support ticket changed before the reply was published.');
      await this.db.prepare(`INSERT INTO support_staff_events
        (id,ticket_id,actor_ref,actor_role,action,reason,prior_revision,result_revision) VALUES(?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),ticketId.data,user.id,role,'replied','Publish an owner-visible in-app support reply.',parsed.data.revision,parsed.data.revision+1);
      const updated=await this.staffRow(ticketId.data);
      return {reply:reply(saved),ticket:this.ticket(updated,user.id)};
    });
  }
}
