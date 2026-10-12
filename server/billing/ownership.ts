import { z } from 'zod';
import type { Database } from '../db/connection';
import { TerminalJobFailure } from '../jobs';
import { customerRowSchema, type CustomerRow } from './checkout-schema';

export async function assertSandboxOwner(db: Database, owner: string, epoch?: number) {
  await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(z.uuid().parse(owner));
  const row = await db.prepare('SELECT status,contact_verified,session_epoch FROM managed_accounts WHERE user_id=? FOR UPDATE').get(owner);
  if (!row || row.status !== 'active' || row.contact_verified !== 1 || epoch !== undefined && Number(row.session_epoch) !== epoch) throw new TerminalJobFailure('not-eligible');
  return z.coerce.number().int().nonnegative().safe().parse(row.session_epoch);
}
export async function ownedSandboxCustomer(db: Database, accountId: string, owner: string, id?: string): Promise<CustomerRow | null> {
  const row = await db.prepare(`SELECT * FROM stripe_owned_customers WHERE account_id=? AND user_id=?${id ? ' AND id=?' : ''} FOR UPDATE`)
    .get(accountId, owner, ...(id ? [id] : []));
  return row ? customerRowSchema.parse(row) : null;
}
