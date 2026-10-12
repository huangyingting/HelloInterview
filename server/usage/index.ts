import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/connection';
import { assertDatabaseVersion } from '../db/migrations';
import { HttpError } from '../http-error';
import { digest, encodePayload, readOperation, requestDigest, type Operation, type OperationRequest } from '../jobs/schema';
import { monthlyUsageWindow, utcCostWindows } from './calendar';
import { amount, budgetRowSchema, completionSchema, evidenceSchema, instant, releaseSchema,
  reservationRequestSchema, reservationRowSchema, usagePolicySchema, windowRowSchema,
  type ReservationRequest, type ReservationRow, type UsagePolicy } from './schema';
export { sandboxUsagePolicy, type ReservationRequest, type UsagePolicy } from './schema';
export { SandboxInputs } from './inputs';
export { sandboxInputPolicy, type InputPolicy, type InputRequest } from './schema';

const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const lineageSchema = z.object({ id: z.uuid(), owner_ref: z.uuid(), user_id: z.uuid().nullable(),
  anchor: z.coerce.number().pipe(instant), service_start: z.coerce.number().pipe(instant), service_end: z.coerce.number().pipe(instant) });
const serviceSchema = z.object({ starts_at: z.coerce.number().pipe(instant), ends_at: z.coerce.number().pipe(instant), revoked: z.boolean() });
const totalSchema = z.object({ reserved: z.coerce.number().pipe(amount), consumed: z.coerce.number().pipe(amount) });
const bindingSchema = z.object({ reservation_id: z.uuid(), owner_ref: z.uuid(), operation_id: z.uuid(),
  operation_scope: z.string(), operation_kind: z.literal('ai.evaluate'),
  operation_request_hash: z.string().regex(/^[a-f0-9]{64}$/), job_id: z.uuid(),
  generation: z.literal(0), created_at: z.date() });

export class SandboxUsage {
  private constructor(private readonly db: Database, private readonly policy: UsagePolicy, private readonly policyHash: string) {}
  static async open(db: Database, input: UsagePolicy) {
    if (db.dialect !== 'postgres') throw new Error('Sandbox usage requires controlled PostgreSQL; local AI remains separate.');
    const policy = usagePolicySchema.parse(input), payload = encodePayload(policy), hash = digest(payload);
    await assertDatabaseVersion(db);
    const usage = new SandboxUsage(db, policy, hash);
    await db.transaction(async () => {
      await usage.lockGlobal();
      await db.prepare('INSERT INTO ai_usage_policies(id,payload,request_hash) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING')
        .run(policy.id, payload, hash);
      await usage.assertPolicy();
    });
    return usage;
  }
  private async lockGlobal() {
    await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get('sandbox-ai-usage');
  }
  private async assertPolicy() {
    const row = await this.db.prepare('SELECT payload,request_hash FROM ai_usage_policies WHERE id=?').get(this.policy.id);
    if (!row || row.request_hash !== this.policyHash || digest(z.string().parse(row.payload)) !== this.policyHash ||
      encodePayload(usagePolicySchema.parse(JSON.parse(z.string().parse(row.payload)))) !== encodePayload(this.policy)) {
      throw new HttpError(409, 'Retained sandbox usage policy conflicts; do not replace limits or reset balances.');
    }
  }
  private async now() { return instant.parse(Number((await this.db.prepare(`SELECT ${clock} AS now`).get())?.now)); }
  private async lockOwner(owner: string, epoch?: number, cleanup = false) {
    z.uuid().parse(owner);
    const row = await this.db.prepare(`SELECT a.status,a.contact_verified,a.session_epoch FROM users u
      JOIN managed_accounts a ON a.user_id=u.id WHERE u.id=? FOR UPDATE OF u,a`).get(owner);
    if (!cleanup && (!row || row.status !== 'active' || row.contact_verified !== 1 ||
      epoch !== undefined && Number(row.session_epoch) !== epoch)) throw new HttpError(403, 'Current verified account or security epoch does not allow sandbox usage.');
    await this.lockGlobal();
    await this.assertPolicy();
  }
  private async services(owner: string) {
    const rows = await this.db.prepare(`SELECT starts_at,ends_at,EXISTS(SELECT 1 FROM entitlement_revocations r
      WHERE r.source_kind=g.source_kind AND r.source_key=g.source_key) AS revoked FROM entitlement_grants g
      WHERE g.user_id=? AND g.policy='pro-v1' ORDER BY starts_at,ends_at`).all(owner);
    return rows.map(row => serviceSchema.parse(row));
  }
  private async assertPaid(owner: string) {
    const now = await this.now(), rows = await this.services(owner);
    if (!rows.some(row => !row.revoked && row.starts_at <= now && now < row.ends_at)) {
      throw new HttpError(403, 'A current Pro interval is required to reserve or publish sandbox usage; owned history is unchanged.');
    }
    return { now, rows };
  }
  private async window(owner: string) {
    const { now, rows } = await this.assertPaid(owner);
    const components: { start: number; end: number; eligible: boolean }[] = [];
    for (const row of rows) {
      const eligible = !row.revoked && row.starts_at <= now && now < row.ends_at, last = components.at(-1);
      if (last && row.starts_at <= last.end) { last.end = Math.max(last.end, row.ends_at); last.eligible ||= eligible; }
      else components.push({ start: row.starts_at, end: row.ends_at, eligible });
    }
    const component = components.find(component => component.eligible);
    if (!component) throw new HttpError(403, 'A supported current usage interval is missing.');
    const matches = await this.db.prepare(`SELECT * FROM ai_usage_lineages WHERE owner_ref=?
      AND service_start<=? AND service_end>=? FOR UPDATE`).all(owner, component.end, component.start);
    if (matches.length > 1) throw new HttpError(409, 'Previously distinct usage lineages now intersect; operator review is required, not another allowance.');
    let lineage;
    if (matches[0]) {
      lineage = lineageSchema.parse(matches[0]);
      if (lineage.user_id !== owner) throw new HttpError(409, 'Retired usage authority cannot be assigned to a replacement owner.');
      await this.db.prepare('UPDATE ai_usage_lineages SET service_start=least(service_start,?),service_end=greatest(service_end,?) WHERE id=?')
        .run(component.start, component.end, lineage.id);
    } else {
      const id = randomUUID();
      await this.db.prepare('INSERT INTO ai_usage_lineages(id,owner_ref,user_id,anchor,service_start,service_end) VALUES(?,?,?,?,?,?)')
        .run(id, owner, owner, component.start, component.start, component.end);
      lineage = lineageSchema.parse(await this.db.prepare('SELECT * FROM ai_usage_lineages WHERE id=?').get(id));
    }
    if (now < lineage.anchor) throw new HttpError(409, 'Backfilled service precedes the retained usage anchor; operator reconciliation is required.');
    const interval = monthlyUsageWindow(lineage.anchor, now), id = randomUUID();
    await this.db.prepare(`INSERT INTO ai_usage_windows(id,owner_ref,lineage_id,policy_id,starts_at,ends_at,unit_limit)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(lineage_id,starts_at) DO NOTHING`)
      .run(id, owner, lineage.id, this.policy.id, interval.startsAt, interval.endsAt, this.policy.monthlyUnits);
    const row = windowRowSchema.parse(await this.db.prepare('SELECT * FROM ai_usage_windows WHERE lineage_id=? AND starts_at=? FOR UPDATE')
      .get(lineage.id, interval.startsAt));
    if (row.owner_ref !== owner || row.policy_id !== this.policy.id || row.ends_at !== interval.endsAt || row.unit_limit !== this.policy.monthlyUnits) {
      throw new HttpError(409, 'The retained allowance window conflicts with its original policy or anchor.');
    }
    return { row, now };
  }
  private async audit(row: ReservationRow, action: string, evidence: z.infer<typeof evidenceSchema>) {
    await this.db.prepare('INSERT INTO ai_usage_events(id,reservation_id,owner_ref,action,actor,reason) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), row.id, row.owner_ref, action, evidence.actor, evidence.reason);
  }
  private async reservation(owner: string, id: string) {
    const raw = await this.db.prepare('SELECT * FROM ai_usage_reservations WHERE owner_ref=? AND id=? FOR UPDATE').get(owner, z.uuid().parse(id));
    if (!raw) throw new HttpError(404, 'Owned sandbox usage reservation not found.');
    const row = reservationRowSchema.parse(raw), request = reservationRequestSchema.parse(JSON.parse(row.request_payload));
    if (row.owner_ref !== request.owner || row.request_key !== request.key || row.units !== this.policy.costs[request.kind] ||
      row.cost_ceiling !== request.costCeilingMicros || row.policy_id !== this.policy.id ||
      row.request_hash !== digest(encodePayload({ request, policyHash: this.policyHash }))) {
      throw new HttpError(409, 'The immutable sandbox reservation conflicts with its retained request.');
    }
    return { row, request };
  }
  private sameRequest(current: ReservationRow, original: ReservationRow) {
    const fields = ['id', 'owner_ref', 'user_id', 'request_key', 'window_id', 'policy_id', 'request_payload', 'request_hash', 'units', 'cost_ceiling'] as const;
    if (fields.some(field => current[field] !== original[field]) || current.created_at.getTime() !== original.created_at.getTime()) {
      throw new HttpError(409, 'The captured usage reservation changed during publication.');
    }
  }
  private async integrity(row: ReservationRow) {
    const window = windowRowSchema.parse(await this.db.prepare('SELECT * FROM ai_usage_windows WHERE id=? AND owner_ref=? FOR UPDATE')
      .get(row.window_id, row.owner_ref));
    const lineage = lineageSchema.parse(await this.db.prepare('SELECT * FROM ai_usage_lineages WHERE id=? AND owner_ref=?').get(window.lineage_id, row.owner_ref));
    const interval = monthlyUsageWindow(lineage.anchor, row.created_at.getTime());
    const totals = totalSchema.parse(await this.db.prepare(`SELECT
      coalesce(sum(units) FILTER(WHERE state IN ('reserved','dispatched','unknown')),0) AS reserved,
      coalesce(sum(units) FILTER(WHERE state='consumed'),0) AS consumed FROM ai_usage_reservations WHERE window_id=?`).get(window.id));
    if (window.policy_id !== this.policy.id || window.unit_limit !== this.policy.monthlyUnits ||
      window.starts_at !== interval.startsAt || window.ends_at !== interval.endsAt ||
      totals.reserved !== window.reserved || totals.consumed !== window.consumed) throw new HttpError(409, 'Allowance balance requires reconciliation.');
    const links = await this.db.prepare('SELECT * FROM ai_usage_budget_links WHERE reservation_id=? ORDER BY kind').all(row.id);
    if (links.length !== 2 || links[0].kind !== 'day' || links[1].kind !== 'month') throw new HttpError(409, 'Both captured cost budgets are required.');
    const budgets = [];
    for (const link of links) {
      const budget = budgetRowSchema.parse(await this.db.prepare('SELECT * FROM ai_usage_cost_budgets WHERE kind=? AND starts_at=? FOR UPDATE')
        .get(String(link.kind), Number(link.starts_at)));
      const captured = utcCostWindows(row.created_at.getTime()).find(window => window.kind === budget.kind);
      const sums = totalSchema.parse(await this.db.prepare(`SELECT
        coalesce(sum(r.cost_ceiling) FILTER(WHERE r.state IN ('reserved','dispatched','unknown')),0) AS reserved,
        coalesce(sum(r.actual_cost) FILTER(WHERE r.state IN ('consumed','released')),0) AS consumed
        FROM ai_usage_budget_links l JOIN ai_usage_reservations r ON r.id=l.reservation_id WHERE l.kind=? AND l.starts_at=?`)
        .get(budget.kind, budget.starts_at));
      if (budget.policy_id !== this.policy.id || budget.starts_at !== captured?.startsAt || budget.ends_at !== captured?.endsAt ||
        budget.cost_limit !== (budget.kind === 'day' ? this.policy.dailyCostMicros : this.policy.monthlyCostMicros) ||
        sums.reserved !== budget.reserved || sums.consumed !== budget.consumed) throw new HttpError(409, 'Captured provider cost balance requires reconciliation.');
      budgets.push(budget);
    }
    return { window, budgets };
  }
  private jobRequest(row: ReservationRow): OperationRequest {
    return { principal: { type: 'user', id: row.owner_ref }, kind: 'ai.evaluate', key: `usage:${row.request_key}`,
      resource: `usage:${row.id}`, retryMode: 'reconcile',
      payload: { reservationId: row.id, authority: this.policy.id, requestHash: row.request_hash } };
  }
  private async binding(row: ReservationRow, required = false) {
    const raw = await this.db.prepare('SELECT * FROM ai_usage_operations WHERE reservation_id=?').get(row.id);
    if (!raw) {
      if (required) throw new HttpError(409, 'This reservation has no bound native intent.');
      return null;
    }
    const binding = bindingSchema.parse(raw), expected = this.jobRequest(row);
    const saved = await this.db.prepare('SELECT * FROM durable_operations WHERE id=?').get(binding.operation_id);
    if (!saved) throw new HttpError(409, 'The bound native operation is missing.');
    const operation = readOperation(saved);
    if (binding.owner_ref !== row.owner_ref || binding.operation_scope !== `user:${row.owner_ref}` ||
      binding.created_at.getTime() < row.created_at.getTime() ||
      binding.operation_request_hash !== requestDigest(binding.operation_scope, expected, encodePayload(expected.payload)) ||
      saved.request_hash !== binding.operation_request_hash || saved.request_key !== expected.key ||
      operation.kind !== expected.kind || operation.principal.type !== 'user' || operation.principal.id !== row.owner_ref ||
      operation.ownerId !== row.user_id || operation.resource !== expected.resource || operation.retryMode !== 'reconcile' ||
      encodePayload(operation.payload) !== encodePayload(expected.payload) || operation.jobId !== binding.job_id ||
      operation.generation !== binding.generation || operation.completedAt !== null) {
      throw new HttpError(409, 'The original reservation/native intent binding changed; reconcile rather than adopting another job.');
    }
    return operation;
  }
  assertDatabase(db: Database) {
    if (db !== this.db) throw new Error('Usage and native jobs must share the exact database adapter and transaction.');
  }
  private async assertUnbound(row: ReservationRow) {
    if (await this.binding(row)) throw new HttpError(409, 'A bound native intent cannot use standalone dispatch or settlement; provider execution remains disabled.');
  }
  async assertQueuedAdmission(owner: string, id: string) {
    return this.db.transaction(async () => {
      await this.lockOwner(owner);
      const { row, request } = await this.reservation(owner, id);
      await this.lockOwner(owner, request.authEpoch); await this.assertPaid(owner);
      if (row.user_id !== owner || row.state !== 'reserved' || !await this.binding(row, true)) {
        throw new HttpError(409, 'Only an owned held native intent can prepare its original input.');
      }
      await this.assertDispatchWindow(row, (await this.integrity(row)).budgets);
    });
  }
  async bindJob(db: Database, input: ReservationRequest, create: (request: OperationRequest) => Promise<Operation>,
    confirm: (operation: Operation, required: boolean) => Promise<void>) {
    this.assertDatabase(db);
    const request = reservationRequestSchema.parse(input);
    return this.db.transaction(async () => {
      const reservation = await this.reserve(request), { row } = await this.reservation(request.owner, reservation.id);
      const previous = await this.binding(row);
      if (previous) { await confirm(previous, false); return { reservation, operation: previous }; }
      if (row.state !== 'reserved' || row.user_id !== request.owner) throw new HttpError(409, 'Only an owned undispatched reservation can receive its first native intent.');
      await this.lockOwner(request.owner, request.authEpoch); await this.assertPaid(request.owner);
      await this.assertDispatchWindow(row, (await this.integrity(row)).budgets);
      const operation = await create(this.jobRequest(row));
      await this.db.prepare(`INSERT INTO ai_usage_operations
        (reservation_id,owner_ref,operation_id,operation_scope,operation_kind,operation_request_hash,job_id,generation)
        VALUES(?,?,?,?,'ai.evaluate',?,?,?)`).run(row.id, row.owner_ref, operation.id, `user:${row.owner_ref}`,
          requestDigest(`user:${row.owner_ref}`, this.jobRequest(row), encodePayload(this.jobRequest(row).payload)), operation.jobId, operation.generation);
      await this.lockOwner(request.owner, request.authEpoch); await this.assertPaid(request.owner);
      const current = (await this.reservation(request.owner, row.id)).row; this.sameRequest(current, row);
      if (current.state !== 'reserved') throw new HttpError(409, 'Native intent admission changed its accounting state.');
      await this.assertDispatchWindow(current, (await this.integrity(current)).budgets);
      const bound = await this.binding(current, true);
      if (!bound || bound.id !== operation.id) throw new HttpError(409, 'The native intent publication conflicts with its original binding.');
      await confirm(bound, true);
      await this.lockOwner(request.owner, request.authEpoch); await this.assertPaid(request.owner);
      await this.assertDispatchWindow(current, (await this.integrity(current)).budgets);
      return { reservation, operation: bound };
    });
  }
  async cancelJob(db: Database, owner: string, id: string, evidence: z.input<typeof evidenceSchema>,
    cancel: (operation: Operation) => Promise<void>) {
    this.assertDatabase(db);
    const release = releaseSchema.parse({ actualCostMicros: 0, evidence }), hash = digest(encodePayload({ state: 'released', release }));
    return this.db.transaction(async () => {
      await this.lockOwner(owner, undefined, true);
      const { row } = await this.reservation(owner, id); await this.integrity(row);
      const operation = await this.binding(row, true);
      if (!operation) throw new HttpError(409, 'The bound native intent is missing.');
      if (!['reserved', 'released'].includes(row.state) || row.dispatched_at !== null) {
        throw new HttpError(409, 'Only known undispatched native intents can be cancelled at zero cost.');
      }
      if (row.state === 'released' && row.settlement_hash !== hash) throw new HttpError(409, 'The original native cancellation evidence cannot be replaced.');
      await cancel(operation);
      const before = (await this.reservation(owner, id)).row; this.sameRequest(before, row);
      if (before.state !== row.state || before.settlement_hash !== row.settlement_hash || before.dispatched_at !== null) {
        throw new HttpError(409, 'Native cancellation changed its captured accounting state.');
      }
      await this.binding(before, true);
      if (row.state === 'reserved') await this.settle(row, 'released', 0, hash, null, release.evidence);
      await this.binding((await this.reservation(owner, id)).row, true); await this.assertPolicy();
    });
  }
  async reserve(input: ReservationRequest) {
    const request = reservationRequestSchema.parse(input), hash = digest(encodePayload({ request, policyHash: this.policyHash }));
    return this.db.transaction(async () => {
      await this.lockOwner(request.owner, request.authEpoch);
      const existing = await this.db.prepare('SELECT id,request_hash FROM ai_usage_reservations WHERE owner_ref=? AND request_key=?').get(request.owner, request.key);
      if (existing) {
        if (existing.request_hash !== hash) throw new HttpError(409, 'This usage key already belongs to a different immutable input or consent.');
        const { row } = await this.reservation(request.owner, z.uuid().parse(existing.id));
        if (row.user_id !== request.owner) throw new HttpError(409, 'Retired usage authority cannot be adopted by a replacement account.');
        await this.integrity(row); await this.binding(row);
        return { id: row.id, state: row.state };
      }
      const { row: window, now } = await this.window(request.owner), units = this.policy.costs[request.kind];
      if (window.consumed + window.reserved + units > window.unit_limit) throw new HttpError(429, 'The monthly sandbox allowance is exhausted; no replacement window was created.');
      const budgets = utcCostWindows(now);
      for (const budget of budgets) {
        const limit = budget.kind === 'day' ? this.policy.dailyCostMicros : this.policy.monthlyCostMicros;
        await this.db.prepare(`INSERT INTO ai_usage_cost_budgets(kind,starts_at,ends_at,policy_id,cost_limit)
          VALUES(?,?,?,?,?) ON CONFLICT(kind,starts_at) DO NOTHING`).run(budget.kind, budget.startsAt, budget.endsAt, this.policy.id, limit);
        const saved = budgetRowSchema.parse(await this.db.prepare('SELECT * FROM ai_usage_cost_budgets WHERE kind=? AND starts_at=? FOR UPDATE').get(budget.kind, budget.startsAt));
        if (saved.policy_id !== this.policy.id || saved.ends_at !== budget.endsAt || saved.cost_limit !== limit) throw new HttpError(409, 'Retained cost budget policy conflicts.');
        if (saved.reserved + saved.consumed + request.costCeilingMicros > saved.cost_limit) throw new HttpError(429, 'The shared sandbox cost ceiling is exhausted.');
      }
      const id = randomUUID();
      await this.db.prepare(`INSERT INTO ai_usage_reservations
        (id,owner_ref,user_id,request_key,window_id,policy_id,request_payload,request_hash,units,cost_ceiling,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?::timestamptz)`)
        .run(id, request.owner, request.owner, request.key, window.id, this.policy.id, encodePayload(request), hash, units, request.costCeilingMicros, new Date(now).toISOString());
      for (const budget of budgets) {
        await this.db.prepare('INSERT INTO ai_usage_budget_links(reservation_id,kind,starts_at) VALUES(?,?,?)').run(id, budget.kind, budget.startsAt);
        await this.db.prepare('UPDATE ai_usage_cost_budgets SET reserved=reserved+? WHERE kind=? AND starts_at=?')
          .run(request.costCeilingMicros, budget.kind, budget.startsAt);
      }
      await this.db.prepare('UPDATE ai_usage_windows SET reserved=reserved+? WHERE id=?').run(units, window.id);
      const { row } = await this.reservation(request.owner, id); await this.audit(row, 'reserved', request.evidence);
      await this.lockOwner(request.owner, request.authEpoch); await this.assertPaid(request.owner);
      const current = (await this.reservation(request.owner, id)).row;
      if (current.request_hash !== hash || current.window_id !== window.id || current.state !== 'reserved' || current.user_id !== request.owner) {
        throw new HttpError(409, 'Usage admission publication changed.');
      }
      await this.integrity(current);
      return { id, state: current.state };
    });
  }
  private async assertDispatchWindow(row: ReservationRow, budgets: z.infer<typeof budgetRowSchema>[]) {
    const now = await this.now(), age = now - row.created_at.getTime();
    if (age < 0 || age >= this.policy.maxQueueAgeMs || budgets.some(budget => now >= budget.ends_at)) {
      throw new HttpError(409, 'The captured queue or cost-budget window ended before dispatch; explicitly release undispatched work.');
    }
  }
  async markDispatched(owner: string, id: string, evidence: z.input<typeof evidenceSchema>) {
    const proof = evidenceSchema.parse(evidence);
    return this.db.transaction(async () => {
      await this.lockOwner(owner);
      const { row, request } = await this.reservation(owner, id), { budgets } = await this.integrity(row);
      await this.assertUnbound(row);
      if (row.user_id !== owner) throw new HttpError(409, 'Retired usage cannot be dispatched.');
      await this.lockOwner(owner, request.authEpoch); await this.assertPaid(owner);
      if (row.state !== 'reserved') throw new HttpError(409, 'Dispatch was already recorded or resolved; never repeat an ambiguous provider call.');
      await this.assertDispatchWindow(row, budgets);
      const counts = z.object({ global: z.number().int().nonnegative(), owner: z.number().int().nonnegative() }).parse(
        await this.db.prepare(`SELECT count(*)::integer AS global,
          count(*) FILTER(WHERE owner_ref=?)::integer AS owner FROM ai_usage_reservations WHERE state IN ('dispatched','unknown')`).get(owner));
      if (counts.global >= this.policy.globalConcurrency || counts.owner >= this.policy.ownerConcurrency) {
        throw new HttpError(429, 'Sandbox provider concurrency is occupied, including unresolved outcomes.');
      }
      await this.db.prepare("UPDATE ai_usage_reservations SET state='dispatched',dispatched_at=clock_timestamp() WHERE id=?").run(id);
      await this.audit(row, 'dispatched', proof); await this.lockOwner(owner, request.authEpoch); await this.assertPaid(owner);
      const current = (await this.reservation(owner, id)).row; this.sameRequest(current, row);
      if (current.state !== 'dispatched') throw new HttpError(409, 'Dispatch publication changed.');
      await this.assertDispatchWindow(current, (await this.integrity(current)).budgets);
    });
  }
  async markUnknown(owner: string, id: string, evidence: z.input<typeof evidenceSchema>) {
    const proof = evidenceSchema.parse(evidence);
    return this.db.transaction(async () => {
      await this.lockOwner(owner, undefined, true);
      const { row } = await this.reservation(owner, id); await this.integrity(row);
      await this.assertUnbound(row);
      if (row.state === 'unknown') return;
      if (row.state !== 'dispatched') throw new HttpError(409, 'Only a recorded dispatch can become ambiguous.');
      await this.db.prepare("UPDATE ai_usage_reservations SET state='unknown' WHERE id=?").run(id);
      await this.audit(row, 'unknown', proof);
      const current = (await this.reservation(owner, id)).row; this.sameRequest(current, row);
      if (current.state !== 'unknown') throw new HttpError(409, 'Unknown-outcome publication changed.');
      await this.integrity(current);
    });
  }
  private async settle(row: ReservationRow, state: 'consumed' | 'released', actualCost: number, hash: string,
    resultHash: string | null, evidence: z.infer<typeof evidenceSchema>) {
    if (actualCost > row.cost_ceiling) throw new HttpError(409, 'Actual provider cost exceeds its captured ceiling; explicit cost reconciliation is required.');
    const { budgets } = await this.integrity(row);
    await this.db.prepare(`UPDATE ai_usage_reservations SET state=?,actual_cost=?,result_hash=?,settlement_hash=?,finished_at=clock_timestamp() WHERE id=?`)
      .run(state, actualCost, resultHash, hash, row.id);
    await this.db.prepare('UPDATE ai_usage_windows SET reserved=reserved-?,consumed=consumed+? WHERE id=?')
      .run(row.units, state === 'consumed' ? row.units : 0, row.window_id);
    for (const budget of budgets) {
      await this.db.prepare('UPDATE ai_usage_cost_budgets SET reserved=reserved-?,consumed=consumed+? WHERE kind=? AND starts_at=?')
        .run(row.cost_ceiling, actualCost, budget.kind, budget.starts_at);
    }
    await this.audit(row, state, evidence);
    const current = (await this.reservation(row.owner_ref, row.id)).row;
    this.sameRequest(current, row);
    if (current.state !== state || current.settlement_hash !== hash || current.result_hash !== resultHash || current.actual_cost !== actualCost) {
      throw new HttpError(409, 'Usage settlement publication changed.');
    }
    await this.integrity(current);
  }
  async complete(owner: string, id: string, input: z.input<typeof completionSchema>, publish: () => Promise<void>) {
    const completion = completionSchema.parse(input), hash = digest(encodePayload({ state: 'consumed', completion }));
    return this.db.transaction(async () => {
      await this.lockOwner(owner);
      const { row, request } = await this.reservation(owner, id);
      await this.assertUnbound(row);
      if (row.user_id !== owner) throw new HttpError(409, 'Retired usage results cannot be published.');
      await this.integrity(row);
      if (row.state === 'consumed') {
        if (row.settlement_hash !== hash) throw new HttpError(409, 'The immutable usage settlement conflicts with its first result.');
        return;
      }
      if (!['dispatched', 'unknown'].includes(row.state)) throw new HttpError(409, 'Only a dispatched result can consume reserved units.');
      if (completion.actualCostMicros > row.cost_ceiling) throw new HttpError(409, 'Actual provider cost exceeds its captured ceiling; reconcile before publishing.');
      await this.lockOwner(owner, request.authEpoch); await this.assertPaid(owner);
      await publish();
      await this.lockOwner(owner, request.authEpoch); await this.assertPaid(owner);
      await this.settle(row, 'consumed', completion.actualCostMicros, hash, completion.resultHash, completion.evidence);
      await this.lockOwner(owner, request.authEpoch); await this.assertPaid(owner);
    });
  }
  async release(owner: string, id: string, input: z.input<typeof releaseSchema>) {
    const release = releaseSchema.parse(input), hash = digest(encodePayload({ state: 'released', release }));
    return this.db.transaction(async () => {
      await this.lockOwner(owner, undefined, true);
      const { row } = await this.reservation(owner, id); await this.integrity(row);
      await this.assertUnbound(row);
      if (row.state === 'released') {
        if (row.settlement_hash !== hash) throw new HttpError(409, 'The immutable usage release conflicts with its first resolution.');
        return;
      }
      if (row.state === 'consumed' || row.state === 'reserved' && release.actualCostMicros !== 0 ||
        ['dispatched', 'unknown'].includes(row.state) && !release.reconciled) {
        throw new HttpError(409, 'Dispatched or ambiguous work needs explicit provider-cost reconciliation; elapsed time is not release proof.');
      }
      await this.settle(row, 'released', release.actualCostMicros, hash, null, release.evidence);
      await this.assertPolicy();
    });
  }
  async view(owner: string, limit = 20) {
    z.number().int().min(1).max(50).parse(limit);
    return this.db.transaction(async () => {
      await this.lockOwner(owner);
      const rows = await this.db.prepare('SELECT id FROM ai_usage_reservations WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(owner, limit + 1);
      const reservations = [];
      for (const raw of rows.slice(0, limit)) {
        const { row, request } = await this.reservation(owner, z.uuid().parse(raw.id));
        const { window } = await this.integrity(row);
        const operation = await this.binding(row);
        reservations.push({ id: row.id, kind: request.kind, state: row.state, units: row.units,
          operationId: operation?.id ?? null,
          createdAt: row.created_at.toISOString(), window: { startsAt: new Date(window.starts_at).toISOString(),
            endsAt: new Date(window.ends_at).toISOString(), limit: window.unit_limit, reserved: window.reserved, consumed: window.consumed } });
      }
      return { authority: this.policy.id, providerEnabled: false as const, reservations, historyTruncated: rows.length > limit };
    });
  }
}
