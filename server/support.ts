import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupportHistory, SupportReceipt, User } from '../shared/types';
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
  created_at: z.iso.datetime(), request_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable() });
const cursorSchema = z.strictObject({ owner: identifier, id: identifier, createdAt: z.iso.datetime() });

function receipt(value: unknown): SupportReceipt {
  const row = rowSchema.parse(value);
  return { id: row.id, email: row.email, body: row.body, createdAt: row.created_at, status: 'saved', delivery: 'not-connected' };
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
      await this.db.prepare(`INSERT INTO support(id,user_id,email,body,created_at,request_key,request_hash)
        VALUES(?,?,?,?,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),?,?)
        ON CONFLICT(user_id,request_key) WHERE request_key IS NOT NULL DO NOTHING`)
        .run(randomUUID(), user.id, request.email, request.body, request.key, hash);
      const row = rowSchema.parse(await this.db.prepare('SELECT * FROM support WHERE user_id=? AND request_key=?').get(user.id, request.key));
      if (row.request_hash !== hash || row.email !== request.email || row.body !== request.body) {
        throw new HttpError(409, 'This support request key already belongs to different saved content; no replacement was made.');
      }
      await this.identity.assertSupport(user);
      return receipt(row);
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
      const tickets = rows.slice(0, 10).map(receipt), last = tickets.at(-1);
      const nextCursor = rows.length > 10 && last ? Buffer.from(JSON.stringify({ owner: user.id, id: last.id, createdAt: last.createdAt })).toString('base64url') : null;
      await this.identity.assertSupport(user);
      return { tickets, nextCursor, delivery: 'not-connected' };
    });
  }
}
