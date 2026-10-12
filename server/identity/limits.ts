import { createHmac } from 'node:crypto';
import { isIP, SocketAddress } from 'node:net';
import { z } from 'zod';
import type express from 'express';
import type { Database } from '../db/connection';
import { HttpError } from '../http-error';

const windowMs = 900000, maximum = 30;
const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const scopes = ['network', 'legacy-account', 'account-security', 'billing'] as const;
type Scope = typeof scopes[number];
const decisionSchema = z.object({
  attempts: z.number().int().min(1).max(maximum + 1),
  retry_after: z.coerce.number().int().min(1).max(windowMs / 1000),
});

export function networkAddress(value: string) {
  const family = isIP(value);
  if (!family) throw new HttpError(503, 'The request address could not be verified. Try again through the configured application edge.');
  const canonical = new SocketAddress({ address: value, family: family === 4 ? 'ipv4' : 'ipv6', port: 0 }).address;
  return canonical.startsWith('::ffff:') && isIP(canonical.slice(7)) === 4 ? canonical.slice(7) : canonical;
}

export class IdentityLimits {
  private readonly key: Buffer;
  constructor(private readonly db: Database, secret: string) {
    if (db.dialect !== 'postgres') throw new Error('Shared identity admission requires PostgreSQL.');
    this.key = createHmac('sha256', secret).update('studio.identity.admission.v1').digest();
  }
  async consume(scope: Scope, identifier: string) {
    const fingerprint = createHmac('sha256', this.key).update(`${scope}:${identifier}`).digest('hex');
    let row: unknown;
    try {
      await this.db.prepare(`DELETE FROM identity_abuse_buckets WHERE expires<=${clock}`).run();
      row = await this.db.prepare(`
        INSERT INTO identity_abuse_buckets (scope,fingerprint,attempts,started,expires)
        SELECT ?,?,1,t.now,t.now+? FROM (SELECT ${clock} AS now) t
        ON CONFLICT (scope,fingerprint) DO UPDATE SET
          attempts=CASE WHEN identity_abuse_buckets.expires<=EXCLUDED.started THEN 1 ELSE least(identity_abuse_buckets.attempts+1,?) END,
          started=CASE WHEN identity_abuse_buckets.expires<=EXCLUDED.started THEN EXCLUDED.started ELSE identity_abuse_buckets.started END,
          expires=CASE WHEN identity_abuse_buckets.expires<=EXCLUDED.started THEN EXCLUDED.expires ELSE identity_abuse_buckets.expires END
        RETURNING attempts,greatest(1,ceil((expires-${clock})/1000.0))::integer AS retry_after
      `).get(scope, fingerprint, windowMs, maximum + 1);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string' ||
        !['42P01', '42501', '08000', '08003', '08006', '57P01', '57P02', '57P03', '53300', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'].includes(error.code)) throw error;
      console.error(JSON.stringify({ event: 'identity.admission.unavailable', code: error.code }));
      throw new HttpError(503, 'Shared sign-in protection is unavailable. Try again later; no new sign-in or security action was admitted.');
    }
    const result = decisionSchema.parse(row);
    return { allowed: result.attempts <= maximum, retryAfter: result.retry_after };
  }
  async enforce(scope: Scope, identifier: string, res: express.Response) {
    const decision = await this.consume(scope, identifier);
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfter));
      throw new HttpError(429, 'Too many attempts. Wait for the shared 15-minute attempt window before trying again.');
    }
  }
}
