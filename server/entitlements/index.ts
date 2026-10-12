import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { capabilities, proCapabilities, type AccessView, type Capability } from '../../shared/access';
import type { Database } from '../db/connection';
import { HttpError } from '../http-error';

const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
const instant = z.number().int().min(0).max(253402300799999);
const sourceSchema = z.strictObject({ kind: z.enum(['billing', 'support', 'promotion', 'engineering']), key: identifier });
const evidenceSchema = z.strictObject({ actor: identifier, reason: z.string().trim().min(10).max(500) });
const grantSchema = z.strictObject({
  owner: z.uuid(), source: sourceSchema, policy: z.enum(['pro-v1', 'premium-read-v1']),
  startsAt: instant, endsAt: instant, evidence: evidenceSchema,
}).refine(value => value.endsAt > value.startsAt && value.endsAt - value.startsAt <= (value.source.kind === 'engineering' ? 1 : 400) * 86400000,
  'Grants require a finite service interval; engineering grants are limited to one day.');
const rowSchema = z.object({
  id: z.uuid(), user_id: z.uuid(), source_kind: sourceSchema.shape.kind, source_key: identifier,
  policy: grantSchema.shape.policy, starts_at: z.coerce.number().pipe(instant), ends_at: z.coerce.number().pipe(instant),
  request_hash: z.string(), revoked: z.boolean(),
});
export type GrantRequest = z.input<typeof grantSchema>;
const freeCapabilities: readonly Capability[] = ['preparation.free.write', 'archive.own.read', 'archive.own.export'];
const policyCapabilities: Record<GrantRequest['policy'], readonly Capability[]> = { 'pro-v1': proCapabilities, 'premium-read-v1': ['content.premium.read'] };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class Entitlements {
  constructor(private readonly db: Database) {
    if (db.dialect !== 'postgres') throw new Error('Managed entitlements require PostgreSQL; local demo access is separate.');
  }
  private async lockOwner(owner: string) {
    if (!await this.db.prepare('SELECT u.id FROM users u JOIN managed_accounts a ON a.user_id=u.id WHERE u.id=? FOR UPDATE OF u').get(owner)) {
      throw new HttpError(404, 'Managed entitlement owner not found.');
    }
  }
  private async lockSource(source: z.infer<typeof sourceSchema>) {
    await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`entitlement:${source.kind}:${source.key}`);
  }
  async issue(input: GrantRequest) {
    const request = grantSchema.parse(input), fingerprint = hash(request);
    return this.db.transaction(async () => {
      await this.lockOwner(request.owner);
      await this.lockSource(request.source);
      const revoked = await this.db.prepare('SELECT user_id FROM entitlement_revocations WHERE source_kind=? AND source_key=?').get(request.source.kind, request.source.key);
      if (revoked && revoked.user_id !== request.owner) throw new HttpError(409, 'This entitlement source belongs to a different owner.');
      const inserted = await this.db.prepare(`INSERT INTO entitlement_grants
        (id,user_id,source_kind,source_key,policy,starts_at,ends_at,request_hash)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (source_kind,source_key) DO NOTHING RETURNING id`).get(
        randomUUID(), request.owner, request.source.kind, request.source.key, request.policy, request.startsAt, request.endsAt, fingerprint);
      const saved = await this.db.prepare('SELECT id,request_hash FROM entitlement_grants WHERE source_kind=? AND source_key=?').get(request.source.kind, request.source.key);
      if (!saved || saved.request_hash !== fingerprint) throw new HttpError(409, 'This immutable entitlement source conflicts with its original grant.');
      const currentRevocation = await this.db.prepare('SELECT user_id FROM entitlement_revocations WHERE source_kind=? AND source_key=?').get(request.source.kind, request.source.key);
      if (currentRevocation && currentRevocation.user_id !== request.owner) throw new HttpError(409, 'This entitlement source belongs to a different owner.');
      if (inserted) await this.audit(request.owner, String(saved.id), 'issued', request.evidence, request.source);
      return { id: z.uuid().parse(saved.id), revoked: !!currentRevocation };
    });
  }
  async revoke(owner: string, source: z.input<typeof sourceSchema>, evidence: z.input<typeof evidenceSchema>) {
    z.uuid().parse(owner);
    const reference = sourceSchema.parse(source), proof = evidenceSchema.parse(evidence);
    return this.db.transaction(async () => {
      await this.lockOwner(owner);
      await this.lockSource(reference);
      const grant = await this.db.prepare('SELECT id,user_id FROM entitlement_grants WHERE source_kind=? AND source_key=?').get(reference.kind, reference.key);
      if (grant && grant.user_id !== owner) throw new HttpError(404, 'Entitlement source not found.');
      const inserted = await this.db.prepare(`INSERT INTO entitlement_revocations (source_kind,source_key,user_id)
        VALUES (?,?,?) ON CONFLICT (source_kind,source_key) DO NOTHING RETURNING user_id`).get(reference.kind, reference.key, owner);
      const saved = await this.db.prepare('SELECT user_id FROM entitlement_revocations WHERE source_kind=? AND source_key=?').get(reference.kind, reference.key);
      if (!saved || saved.user_id !== owner) throw new HttpError(409, 'The revoked entitlement source belongs to a different owner.');
      if (inserted) await this.audit(owner, grant ? String(grant.id) : null, 'revoked', proof, reference);
      return { duplicate: !inserted };
    });
  }
  private async audit(owner: string, grant: string | null, action: string, evidence: z.infer<typeof evidenceSchema>, source: z.infer<typeof sourceSchema>) {
    await this.db.prepare('INSERT INTO entitlement_events (id,user_id,grant_id,action,actor,reason,source_kind,source_key) VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), owner, grant, action, evidence.actor, evidence.reason, source.kind, source.key);
  }
  async view(owner: string | null): Promise<AccessView> {
    const account = owner ? await this.db.prepare('SELECT status,contact_verified FROM managed_accounts WHERE user_id=?').get(z.uuid().parse(owner)) : undefined;
    if (owner && !account) throw new HttpError(404, 'Managed entitlement owner not found.');
    const active = account?.status === 'active' && account.contact_verified === 1;
    const rows = owner ? await this.db.prepare(`SELECT g.*,EXISTS(SELECT 1 FROM entitlement_revocations r WHERE r.source_kind=g.source_kind AND r.source_key=g.source_key) AS revoked
      FROM entitlement_grants g WHERE g.user_id=? ORDER BY g.ends_at DESC,g.id`).all(owner) : [];
    const grants = rows.map(row => rowSchema.parse(row));
    const now = z.coerce.number().int().parse((await this.db.prepare('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now').get())?.now);
    const features: AccessView['features'] = capabilities.map(key => {
      const candidates = grants.filter(grant => policyCapabilities[grant.policy].includes(key));
      const eligible = candidates.filter(grant => !grant.revoked && grant.starts_at <= now && now < grant.ends_at);
      const allowed = !!owner && active && (freeCapabilities.includes(key) || eligible.length > 0);
      const reason = !owner ? 'anonymous' : !active ? 'restricted' : key === 'ai.feedback.consume' ? 'unavailable' :
        freeCapabilities.includes(key) ? 'free' : eligible.length ? 'granted' :
        candidates.some(grant => !grant.revoked && grant.starts_at > now) ? 'scheduled' :
        candidates.some(grant => !grant.revoked && grant.ends_at <= now) ? 'expired' : candidates.some(grant => grant.revoked) ? 'revoked' : 'no-grant';
      return { key, allowed, reason, validUntil: allowed && eligible.length ? new Date(eligible.reduce((end, grant) => Math.max(end, grant.ends_at), 0)).toISOString() : null };
    });
    const boundaries = grants.filter(grant => !grant.revoked).flatMap(grant => [grant.starts_at, grant.ends_at]).filter(time => time > now);
    return {
      authority: 'managed', serverTime: new Date(now).toISOString(), nextChangeAt: boundaries.length ? new Date(boundaries.reduce((earliest, time) => Math.min(earliest, time), Infinity)).toISOString() : null,
      state: !owner ? 'visitor' : !active ? 'restricted' : features.some(feature => feature.allowed && feature.key === 'mock.create') ? 'pro' :
        features.some(feature => feature.allowed && feature.key === 'content.premium.read') ? 'read-only' : 'free',
      features, sources: grants.slice(0, 50).map(grant => ({
        id: grant.id, kind: grant.source_kind, policy: grant.policy, startsAt: new Date(grant.starts_at).toISOString(), endsAt: new Date(grant.ends_at).toISOString(), revoked: grant.revoked,
      })), sourceHistoryTruncated: grants.length > 50,
    };
  }
  async allows(owner: string, capability: Capability) { return (await this.view(owner)).features.some(feature => feature.key === capability && feature.allowed); }
  async assert(owner: string, capability: Capability) {
    if (!await this.allows(owner, capability)) throw new HttpError(403, `Current verified access does not allow ${capability}. Your saved archive is unchanged.`);
  }
}
