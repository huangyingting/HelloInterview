import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { IdentityConfig } from '../config';
import type { Database } from '../db/connection';
import { HttpError } from '../http-error';
import { DurableJobs, TerminalJobFailure, type JobClaim, type Operation } from '../jobs';
import { digest } from '../jobs/schema';
import { subjectSchema, type IdentityProof, type IdentityTransport } from './broker';
import { IdentityManagement, type SecurityFacts } from './management';

const eventSchema = z.strictObject({
  version: z.literal(1), eventId: z.uuid(), issuer: z.string(), subject: subjectSchema,
  kind: z.literal('password-changed'), occurredAt: z.number().int().nonnegative(),
});
const operationSchema = z.strictObject({ issuer: z.string(), subject: subjectSchema });
export async function lockSubject(db: Database, issuer: string, subject: string) {
  await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`${issuer}:${subject}`);
}

export class IdentityLifecycle {
  private constructor(private readonly db: Database, private readonly settings: IdentityConfig, readonly jobs: DurableJobs, readonly management: IdentityManagement) {}
  static async open(db: Database, settings: IdentityConfig, shutdown: AbortSignal, transport?: IdentityTransport, worker = false) {
    if (!settings.lifecycle) throw new Error('Identity lifecycle configuration is required.');
    const management = new IdentityManagement(settings.lifecycle, shutdown, transport);
    return new IdentityLifecycle(db, settings, await DurableJobs.open(db, worker), management);
  }
  private source() { return `identity:${digest(this.settings.issuer)}`; }
  private resource(subject: string) { return `identity:${digest(`${this.settings.issuer}:${subject}`)}`; }
  private async locked<T>(subject: string, action: (owner: string | null) => Promise<T>): Promise<T> {
    return this.db.transaction(async () => {
      await lockSubject(this.db, this.settings.issuer, subject);
      const row = await this.db.prepare('SELECT user_id FROM managed_identities WHERE issuer=? AND subject=?').get(this.settings.issuer, subject);
      const owner = row ? z.string().parse(row.user_id) : null;
      if (owner) await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(owner);
      await this.db.prepare('INSERT INTO identity_subject_security (issuer,subject) VALUES (?,?) ON CONFLICT DO NOTHING').run(this.settings.issuer, subject);
      return action(owner);
    });
  }
  private async revoke(owner: string, cutoff: number, action: string) {
    await this.db.prepare('UPDATE managed_accounts SET security_cutoff=greatest(security_cutoff,?),session_epoch=session_epoch+1 WHERE user_id=?').run(cutoff, owner);
    await this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner);
    await this.db.prepare('DELETE FROM auth_transactions WHERE user_id=?').run(owner);
    await this.db.prepare('INSERT INTO identity_security_events (id,user_id,action) VALUES (?,?,?)').run(randomUUID(), owner, action);
  }
  register(app: express.Express) {
    const raw = express.raw({ type: 'application/json', limit: '4kb', inflate: false });
    app.post('/webhooks/identity/password-change', (req, res, next) => raw(req, res, (error: unknown) => {
      if (error && typeof error === 'object' && 'type' in error) {
        if (error.type === 'entity.too.large') return next(new HttpError(413, 'The identity event exceeds its size limit.'));
        if (error.type === 'encoding.unsupported') return next(new HttpError(415, 'Compressed identity events are not supported.'));
      }
      next(error);
    }), async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const timestamp = req.get('X-Studio-Timestamp'), signature = req.get('X-Studio-Signature');
      if (!Buffer.isBuffer(req.body) || !timestamp || !/^\d{13}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/.test(signature) ||
        Math.abs(Date.now() - Number(timestamp)) > 300000) throw new HttpError(403, 'The identity event could not be authenticated.');
      const key = this.settings.lifecycle?.hookSecret;
      if (!key) throw new Error('The identity event signing key is unavailable.');
      const expected = createHmac('sha256', Buffer.from(key, 'hex')).update(`${timestamp}.`).update(req.body).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new HttpError(403, 'The identity event could not be authenticated.');
      let event: z.infer<typeof eventSchema>;
      try { event = eventSchema.parse(JSON.parse(req.body.toString('utf8'))); }
      catch (error) {
        if (error instanceof SyntaxError || error instanceof z.ZodError) throw new HttpError(400, 'The authenticated identity event is malformed.');
        throw error;
      }
      if (event.issuer !== this.settings.issuer || !event.subject.startsWith('auth0|') || event.occurredAt > Date.now() + 5000) throw new HttpError(400, 'The identity event does not match this broker password authority.');
      let duplicate = false;
      await this.locked(event.subject, async owner => {
        const accepted = await this.jobs.ingestVerifiedEvent({
          source: this.source(), eventId: event.eventId, payload: event,
          operation: { kind: 'identity.reconcile', resource: this.resource(event.subject), payload: { issuer: this.settings.issuer, subject: event.subject }, retryMode: 'idempotent' },
        });
        duplicate = accepted.duplicate;
        if (duplicate) return;
        const current = await this.db.prepare('SELECT auth_cutoff FROM identity_subject_security WHERE issuer=? AND subject=?').get(this.settings.issuer, event.subject);
        if (event.occurredAt <= Number(current?.auth_cutoff)) return;
        await this.db.prepare('UPDATE identity_subject_security SET auth_cutoff=? WHERE issuer=? AND subject=?').run(event.occurredAt, this.settings.issuer, event.subject);
        if (owner) await this.revoke(owner, event.occurredAt, 'provider-password-changed');
      });
      res.json({ accepted: true, duplicate });
    });
  }
  async observe(facts: SecurityFacts) {
    return this.locked(facts.subject, async owner => {
      const row = await this.db.prepare('SELECT auth_cutoff,canonical_version,disabled FROM identity_subject_security WHERE issuer=? AND subject=?').get(this.settings.issuer, facts.subject);
      if (!row) throw new Error('The identity security authority is missing.');
      if (facts.version < Number(row.canonical_version)) return { version: Number(row.canonical_version), disabled: Number(row.disabled) };
      const disabled = Number(row.disabled) === 2 ? 2 : facts.disabled;
      const identity = owner ? await this.db.prepare('SELECT id,email,verified,available FROM managed_identities WHERE issuer=? AND subject=?').get(this.settings.issuer, facts.subject) : undefined;
      if (owner && !identity) throw new Error('The mapped identity disappeared under its subject lock.');
      const changed = !!identity && (identity.email !== facts.email || identity.verified !== Number(facts.verified) || identity.available !== Number(disabled === 0));
      const cutoff = Math.max(Number(row.auth_cutoff), facts.cutoff, changed || disabled !== Number(row.disabled) ? facts.version : 0);
      await this.db.prepare('UPDATE identity_subject_security SET auth_cutoff=?,canonical_version=?,disabled=? WHERE issuer=? AND subject=?').run(cutoff, facts.version, disabled, this.settings.issuer, facts.subject);
      if (!owner) return { version: facts.version, disabled };
      if (!identity) throw new Error('The mapped identity disappeared under its subject lock.');
      await this.db.prepare('UPDATE managed_identities SET email=?,verified=?,available=? WHERE id=?').run(facts.email, Number(facts.verified), Number(disabled === 0), String(identity.id));
      const account = await this.db.prepare('SELECT contact_identity_id FROM managed_accounts WHERE user_id=?').get(owner);
      if (changed && account?.contact_identity_id === identity.id) {
        await this.db.prepare("UPDATE managed_accounts SET contact_verified=0,status=CASE WHEN status IN ('active','pending-verification') THEN 'pending-verification' ELSE status END WHERE user_id=?").run(owner);
      }
      if (changed || cutoff > Number(row.auth_cutoff) || disabled !== Number(row.disabled)) {
        await this.revoke(owner, cutoff, 'provider-security-reconciled');
      }
      return { version: facts.version, disabled };
    });
  }
  async assertProof(proof: IdentityProof, facts: SecurityFacts, owner?: string) {
    const row = await this.db.prepare(`
      SELECT s.auth_cutoff,s.canonical_version,s.disabled,a.security_cutoff
      FROM identity_subject_security s LEFT JOIN managed_identities i ON i.issuer=s.issuer AND i.subject=s.subject
      LEFT JOIN managed_accounts a ON a.user_id=coalesce(?,i.user_id) WHERE s.issuer=? AND s.subject=?
    `).get(owner ?? null, proof.issuer, proof.subject);
    if (!row || Number(row.disabled) !== 0 || Number(row.canonical_version) > facts.version ||
      proof.authenticatedAt <= Math.max(Number(row.auth_cutoff), Number(row.security_cutoff ?? 0)) ||
      proof.email !== facts.email || proof.verified !== facts.verified) throw new HttpError(403, 'Provider security or contact information changed. Confirm a fresh sign-in.');
  }
  async enqueueSweep() {
    const tick = z.coerce.number().int().parse((await this.db.prepare('SELECT floor(extract(epoch from clock_timestamp())/60)::bigint AS tick').get())?.tick);
    let cursor = '', count = 0;
    for (;;) {
      const rows = await this.db.prepare('SELECT id,subject FROM managed_identities WHERE issuer=? AND id>? ORDER BY id LIMIT 100').all(this.settings.issuer, cursor);
      for (const row of rows) {
        const id = z.string().parse(row.id), subject = subjectSchema.parse(row.subject);
        await this.jobs.enqueue({ principal: { type: 'system', id: 'identity-maintenance' }, kind: 'identity.reconcile', key: `sweep:${tick}:${id}`,
          resource: this.resource(subject), payload: { issuer: this.settings.issuer, subject }, retryMode: 'idempotent' });
        cursor = id; count++;
      }
      if (rows.length < 100) return count;
    }
  }
  async runClaim(claim: JobClaim, signal?: AbortSignal) {
    const operation: Operation = await this.jobs.operation(claim.data.operationId);
    const input = operationSchema.parse(operation.payload);
    if (operation.kind !== 'identity.reconcile' || operation.principal.type !== 'system' ||
      ![this.source(), 'identity-maintenance'].includes(operation.principal.id) || input.issuer !== this.settings.issuer ||
      operation.resource !== this.resource(input.subject)) throw new TerminalJobFailure('not-eligible');
    const facts = await this.management.facts(input.subject, signal);
    await this.locked(input.subject, async () => {
      await this.jobs.finish(claim, async () => {
        const observed = await this.observe(facts);
        return { observedVersion: observed.version, disabled: observed.disabled };
      }, signal);
    });
  }
  close() { return this.jobs.close(); }
}
