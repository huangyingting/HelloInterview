import type { Database } from '../db/connection';

export async function lockSubject(db: Database, issuer: string, subject: string) {
  await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`${issuer}:${subject}`);
}
