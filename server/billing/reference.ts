import type { Database } from '../db/connection';
import { HttpError } from '../http-error';

export async function bindBillingReference(db: Database, accountId: string) {
  await db.prepare('INSERT INTO stripe_billing_reference (singleton,account_id) VALUES (1,?) ON CONFLICT DO NOTHING').run(accountId);
  const reference = await db.prepare('SELECT account_id FROM stripe_billing_reference WHERE singleton=1').get();
  if (!reference || reference.account_id !== accountId) throw new HttpError(409, 'This application database is bound to a different sandbox billing account.');
}
