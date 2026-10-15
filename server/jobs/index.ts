import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PgBoss, JobWithMetadata } from 'pg-boss';
import type { Database } from '../db/connection';
import { HttpError } from '../http-error';
import { Entitlements } from '../entitlements';
import type { SandboxUsage, ReservationRequest } from '../usage';
import { evidenceSchema } from '../usage/schema';
import { startBoss } from './queue';
import {
  claimDataSchema, deadLetterQueue, digest, encodePayload, eventSchema, identifier,
  jobKinds, queueNames, readOperation, requestDigest, requestSchema,
  type ClaimData, type Operation, type OperationRequest, type Payload, type VerifiedEvent,
} from './schema';
export { inspectMaintainedJobs, migrateJobs } from './queue';
export { postgresConnection } from '../db/connection';
export type { Operation, OperationRequest, Payload, VerifiedEvent } from './schema';

export class LostJobClaim extends Error {
  constructor() { super('The durable job claim is no longer current. No business changes were committed.'); this.name = 'LostJobClaim'; }
}
export class TerminalJobFailure extends Error {
  constructor(readonly code: 'not-eligible' | 'invalid-result' | 'reconciliation-required') {
    super(code); this.name = 'TerminalJobFailure';
  }
}
export type JobClaim = JobWithMetadata<ClaimData>;
export type JobHandler = (operation: Operation, signal: AbortSignal) => Promise<(db: Database) => Promise<Payload>>;
export type JobHandlers = Partial<Record<Operation['kind'], JobHandler>>;
type OperationStatus = 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed' | 'missing';
const commandResponseSchema = z.looseObject({ affected: z.number().int().min(0).max(1) });

export class DurableJobs {
  private closing: Promise<void> | undefined;
  private workersStarted = false;
  private constructor(private readonly db: Database, private readonly boss: PgBoss, private readonly workerEnabled: boolean) {}
  static async open(db: Database, worker = false): Promise<DurableJobs> {
    return new DurableJobs(db, await startBoss(db, worker), worker);
  }
  private assertOpen() {
    if (this.closing) throw new Error('Durable job processing is draining.');
  }
  private async lockOwner(ownerId: string) {
    await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(ownerId);
    await this.db.prepare('SELECT user_id FROM managed_accounts WHERE user_id=? FOR UPDATE').get(ownerId);
  }
  private async ownerActive(ownerId: string | null, kind: Operation['kind']) {
    if (ownerId === null) return false;
    const row = await this.db.prepare('SELECT u.id,a.status,a.contact_verified FROM users u LEFT JOIN managed_accounts a ON a.user_id=u.id WHERE u.id=?').get(ownerId);
    if (!row) return false;
    if (row.status === null) return true;
    if (row.contact_verified !== 1) return false;
    if (kind === 'privacy.delete') return row.status === 'deletion-pending';
    if (row.status !== 'active') return false;
    return kind !== 'ai.evaluate' || new Entitlements(this.db).allows(ownerId, 'ai.feedback.consume');
  }
  private async assertAuthority(operation: Operation) {
    if (operation.kind === 'ai.evaluate' && (operation.principal.type !== 'user' ||
      await this.db.prepare('SELECT reservation_id FROM ai_usage_operations WHERE operation_id=?').get(operation.id)) ||
      operation.principal.type === 'user' && !await this.ownerActive(operation.ownerId, operation.kind)) {
      throw new TerminalJobFailure('not-eligible');
    }
  }
  async enqueue(input: OperationRequest): Promise<Operation> {
    this.assertOpen();
    const request = requestSchema.parse(input), payload = encodePayload(request.payload);
    if (request.kind === 'ai.evaluate' && request.principal.type !== 'user') throw new HttpError(403, 'AI operations require an owned user permission and cannot borrow system authority.');
    return this.db.transaction(async () => {
      if (request.principal.type === 'user') {
        await this.lockOwner(request.principal.id);
        if (!await this.ownerActive(request.principal.id, request.kind)) throw new HttpError(403, 'The current verified account and feature permission do not allow this provider operation.');
      }
      return this.createOperation(request, false, payload);
    });
  }
  private async createOperation(request: OperationRequest, requireNew = false, payload = encodePayload(request.payload)): Promise<Operation> {
    const scope = `${request.principal.type}:${request.principal.id}`;
    const hash = requestDigest(scope, request, payload), id = randomUUID(), jobId = randomUUID();
    const inserted = await this.db.prepare(`INSERT INTO durable_operations
      (id,scope,kind,owner_id,request_key,request_hash,resource,payload,retry_mode,job_id)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (scope,kind,request_key) DO NOTHING RETURNING id`).get(
      id, scope, request.kind, request.principal.type === 'user' ? request.principal.id : null,
      request.key, hash, request.resource, payload, request.retryMode, jobId,
    );
    if (requireNew && !inserted) throw new HttpError(409, 'A first reservation binding cannot adopt a previously unbound operation.');
    const row = await this.db.prepare('SELECT * FROM durable_operations WHERE scope=? AND kind=? AND request_key=?').get(scope, request.kind, request.key);
    if (!row) throw new Error('A durable operation reservation is missing.');
    if (row.request_hash !== hash) throw new HttpError(409, 'This operation key was already used with a different request.');
    const operation = readOperation(row);
    if (inserted) await this.send(operation);
    return operation;
  }
  async enqueueReservedAi(usage: SandboxUsage, input: ReservationRequest) {
    this.assertOpen();
    return usage.bindJob(this.db, input, request => this.createOperation(request, true), async (operation, required) => {
      const [job] = await this.boss.findJobs<ClaimData>(queueNames['ai.evaluate'], { id: operation.jobId });
      if (!job && required || job?.state === 'completed' || required && job?.state !== 'created') throw new LostJobClaim();
      if (job) this.assertReservedJob(operation, job);
    });
  }
  private assertReservedJob(operation: Operation, job: JobClaim) {
    const data = claimDataSchema.parse(job.data);
    if (data.operationId !== operation.id || data.generation !== operation.generation || job.id !== operation.jobId ||
      job.name !== queueNames['ai.evaluate'] || job.retryLimit !== 0 ||
      job.singletonKey !== digest(`${operation.kind}:${operation.resource}`)) throw new LostJobClaim();
  }
  async cancelReservedAi(usage: SandboxUsage, owner: string, id: string, evidence: z.input<typeof evidenceSchema>) {
    this.assertOpen();
    return usage.cancelJob(this.db, owner, id, evidence, async operation => {
      const [job] = await this.boss.findJobs<ClaimData>(queueNames['ai.evaluate'], { id: operation.jobId });
      if (job) {
        this.assertReservedJob(operation, job);
        if (job.state === 'completed') throw new LostJobClaim();
        // Cancel the original undispatched intent, not a worker acknowledgment; attempt fences reject queued jobs.
        if (!['cancelled', 'failed'].includes(job.state) &&
          commandResponseSchema.parse(await this.boss.cancel(queueNames['ai.evaluate'], operation.jobId, { db: this.db })).affected !== 1) {
          throw new LostJobClaim();
        }
      }
      const [current] = await this.boss.findJobs<ClaimData>(queueNames['ai.evaluate'], { id: operation.jobId });
      if (current) {
        this.assertReservedJob(operation, current);
        if (!['cancelled', 'failed'].includes(current.state)) throw new LostJobClaim();
      }
    });
  }
  private async send(operation: Operation): Promise<void> {
    const id = await this.boss.send(queueNames[operation.kind], { operationId: operation.id, generation: operation.generation }, {
      db: this.db, id: operation.jobId,
      singletonKey: digest(`${operation.kind}:${operation.resource}`),
      retryLimit: operation.retryMode === 'idempotent' ? 3 : 0,
    });
    if (id !== operation.jobId) throw new Error('The durable operation was not accepted by its queue.');
  }
  async ingestVerifiedEvent(input: VerifiedEvent): Promise<{ duplicate: boolean; operation: Operation }> {
    const event = eventSchema.parse(input), payload = encodePayload(event.payload), hash = digest(payload);
    return this.db.transaction(async () => {
      const operation = await this.enqueue({
        ...event.operation, principal: { type: 'system', id: event.source },
        key: `event:${digest(`${event.source}:${event.eventId}`)}`,
      });
      const inserted = await this.db.prepare(`INSERT INTO verified_event_inbox
        (source,event_id,payload_hash,payload,operation_id) VALUES (?,?,?,?,?)
        ON CONFLICT (source,event_id) DO NOTHING RETURNING event_id`).get(event.source, event.eventId, hash, payload, operation.id);
      const saved = await this.db.prepare('SELECT payload_hash,payload,operation_id FROM verified_event_inbox WHERE source=? AND event_id=?').get(event.source, event.eventId);
      if (!saved || saved.payload_hash !== hash || saved.payload !== payload || saved.operation_id !== operation.id) {
        throw new HttpError(409, 'This verified event ID conflicts with its saved payload or operation.');
      }
      return { duplicate: !inserted, operation };
    });
  }
  async operation(id: string): Promise<Operation> {
    const row = await this.db.prepare('SELECT * FROM durable_operations WHERE id=?').get(z.uuid().parse(id));
    if (!row) throw new HttpError(404, 'Durable operation not found.');
    return readOperation(row);
  }
  private async status(operation: Operation): Promise<OperationStatus> {
    if (operation.completedAt) return 'completed';
    const [job] = await this.boss.findJobs<ClaimData>(queueNames[operation.kind], { id: operation.jobId });
    return job?.state ?? 'missing';
  }
  async ownedStatus(ownerId: string, id: string) {
    const row = await this.db.prepare('SELECT * FROM durable_operations WHERE owner_id=? AND id=?').get(identifier.parse(ownerId), z.uuid().parse(id));
    if (!row) throw new HttpError(404, 'Durable operation not found.');
    const operation = readOperation(row);
    return { id: operation.id, kind: operation.kind, status: await this.status(operation), createdAt: operation.createdAt, completedAt: operation.completedAt, receipt: operation.receipt };
  }
  async inspect(limit = 50) {
    z.number().int().min(1).max(100).parse(limit);
    const rows = await this.db.prepare('SELECT * FROM durable_operations ORDER BY created_at DESC,id LIMIT ?').all(limit);
    return Promise.all(rows.map(async row => {
      const operation = readOperation(row);
      return { id: operation.id, jobId: operation.jobId, kind: operation.kind, generation: operation.generation, status: await this.status(operation), createdAt: operation.createdAt };
    }));
  }
  async claim(kind: Operation['kind']): Promise<JobClaim | undefined> {
    this.assertOpen();
    const [claim] = await this.boss.fetch<ClaimData>(queueNames[kind], { batchSize: 1, includeMetadata: true });
    if (claim) claimDataSchema.parse(claim.data);
    return claim;
  }
  async assertCurrentClaim(claim: JobClaim, signal?: AbortSignal): Promise<void> {
    this.assertOpen();
    const operation = await this.operation(claimDataSchema.parse(claim.data).operationId);
    await this.assertClaim(operation, claim, signal);
  }
  async assertReservedAiClaim(usage: SandboxUsage, claim: JobClaim, signal?: AbortSignal): Promise<Operation> {
    this.assertOpen();
    usage.assertDatabase(this.db);
    const operation = await this.operation(claimDataSchema.parse(claim.data).operationId);
    await this.assertClaim(operation, claim, signal, current => usage.assertNativeOperation(current).then(() => undefined));
    return operation;
  }
  async heartbeat(claim: JobClaim, signal?: AbortSignal): Promise<void> {
    await this.assertCurrentClaim(claim, signal);
    if (commandResponseSchema.parse(await this.boss.touch(claim.name, claim)).affected !== 1) throw new LostJobClaim();
    await this.assertCurrentClaim(claim, signal);
  }
  async systemStatus(principal: string, id: string) {
    const row = await this.db.prepare('SELECT * FROM durable_operations WHERE scope=? AND id=?').get(`system:${identifier.parse(principal)}`, z.uuid().parse(id));
    if (!row) throw new HttpError(404, 'System operation not found.');
    return { status: await this.status(readOperation(row)) };
  }
  async finish(claim: JobClaim, mutation: (db: Database, operation: Operation) => Promise<Payload>, signal?: AbortSignal): Promise<void> {
    return this.finishAuthorized(claim, mutation, signal, operation => this.assertAuthority(operation));
  }
  async finishReservedAi(
    usage: SandboxUsage,
    claim: JobClaim,
    mutation: (db: Database, operation: Operation) => Promise<Payload>,
    signal?: AbortSignal,
  ): Promise<void> {
    usage.assertDatabase(this.db);
    return this.finishAuthorized(
      claim,
      mutation,
      signal,
      operation => usage.assertNativeOperation(operation).then(() => undefined),
    );
  }
  private async finishAuthorized(
    claim: JobClaim,
    mutation: (db: Database, operation: Operation) => Promise<Payload>,
    signal: AbortSignal | undefined,
    authorize: (operation: Operation) => Promise<void>,
  ): Promise<void> {
    const data = claimDataSchema.parse(claim.data);
    const observed = await this.operation(data.operationId);
    await this.db.transaction(async () => {
      if (observed.ownerId) await this.lockOwner(observed.ownerId);
      const row = await this.db.prepare('SELECT * FROM durable_operations WHERE id=? FOR UPDATE').get(data.operationId);
      if (!row) throw new LostJobClaim();
      const operation = readOperation(row);
      await this.assertClaim(operation, claim, signal, authorize);
      const receipt = encodePayload(await mutation(this.db, operation), 16384);
      await this.assertClaim(operation, claim, signal, authorize);
      const result = await this.boss.complete(claim.name, claim, { operationId: operation.id }, { db: this.db });
      if (commandResponseSchema.parse(result).affected !== 1) throw new LostJobClaim();
      await this.db.prepare('UPDATE durable_operations SET completed_at=clock_timestamp(),receipt=? WHERE id=?').run(receipt, operation.id);
    });
  }
  private async assertClaim(
    operation: Operation,
    claim: JobClaim,
    signal?: AbortSignal,
    authorize: (operation: Operation) => Promise<void> = current => this.assertAuthority(current),
  ): Promise<void> {
    await authorize(operation);
    const [current] = await this.boss.findJobs<ClaimData>(claim.name, { id: claim.id });
    const now = await this.db.prepare('SELECT clock_timestamp() AS now').get();
    const time = z.date().parse(now?.now).getTime();
    if (!current || current.state !== 'active' || current.retryCount !== claim.retryCount || operation.completedAt ||
        operation.jobId !== claim.id || operation.generation !== claim.data.generation ||
        queueNames[operation.kind] !== claim.name || signal?.aborted ||
        time >= current.startedOn.getTime() + current.expireInSeconds * 1000 ||
        current.heartbeatSeconds !== null && time >= (current.heartbeatOn ?? current.startedOn).getTime() + current.heartbeatSeconds * 1000) {
      throw new LostJobClaim();
    }
  }
  async fail(claim: JobClaim, code: 'handler-failed' | 'reconciliation-required' = 'handler-failed'): Promise<boolean> {
    const result = await this.boss.fail(claim.name, claim, { code });
    return commandResponseSchema.parse(result).affected === 1;
  }
  async replay(id: string, actor: string, reason: string, providerReconciled = false): Promise<Operation> {
    this.assertOpen();
    identifier.parse(actor);
    z.boolean().parse(providerReconciled);
    z.string().trim().min(10).max(500).parse(reason);
    return this.db.transaction(async () => {
      const row = await this.db.prepare('SELECT * FROM durable_operations WHERE id=? FOR UPDATE').get(z.uuid().parse(id));
      if (!row) throw new HttpError(404, 'Durable operation not found.');
      const previous = readOperation(row), state = await this.status(previous);
      if (previous.kind === 'ai.evaluate' && await this.db.prepare('SELECT reservation_id FROM ai_usage_operations WHERE operation_id=?').get(previous.id)) {
        throw new HttpError(409, 'Bound AI intents cannot use generic replay. Their original accounting and provider outcome require a reviewed native adapter.');
      }
      if (!['failed', 'cancelled', 'missing'].includes(state)) throw new HttpError(409, 'Only terminal or missing operations can be replayed.');
      if (previous.retryMode === 'reconcile' && !providerReconciled) throw new HttpError(409, 'Reconcile the unknown provider outcome before explicitly acknowledging replay.');
      const jobId = randomUUID(), generation = previous.generation + 1;
      await this.db.prepare('UPDATE durable_operations SET job_id=?,generation=? WHERE id=?').run(jobId, generation, previous.id);
      const next = await this.operation(previous.id);
      await this.send(next);
      await this.db.prepare(`INSERT INTO job_operator_events
        (id,operation_id,actor,reason,previous_job_id,next_job_id,generation,provider_reconciled) VALUES (?,?,?,?,?,?,?,?)`).run(
        randomUUID(), previous.id, actor, reason, previous.jobId, jobId, generation, providerReconciled ? 1 : 0,
      );
      const deadLetters = await this.boss.findJobs<ClaimData>(deadLetterQueue, { data: { operationId: previous.id, generation: previous.generation } });
      if (deadLetters.length > 1) throw new Error('A durable operation has inconsistent dead-letter records.');
      if (deadLetters.length) await this.boss.deleteJob(deadLetterQueue, deadLetters[0], { db: this.db });
      return next;
    });
  }
  async startWorkers(handlers: JobHandlers): Promise<void> {
    this.assertOpen();
    if (!this.workerEnabled || this.workersStarted || !jobKinds.some(kind => handlers[kind])) throw new Error('Start an enabled durable worker once with at least one real registered handler.');
    this.workersStarted = true;
    try {
      for (const kind of jobKinds) {
        const handler = handlers[kind];
        if (!handler) continue;
        const options = { batchSize: 1, includeMetadata: true, perJobResults: true } as const;
        await this.boss.work<ClaimData, Payload, typeof options>(queueNames[kind], options, async ([claim]) => {
          try {
            const operation = await this.operation(claimDataSchema.parse(claim.data).operationId);
            if (operation.jobId !== claim.id || operation.generation !== claim.data.generation || operation.kind !== kind) throw new LostJobClaim();
            await this.assertAuthority(operation);
            const mutation = await handler(operation, claim.signal);
            await this.finish(claim, db => mutation(db), claim.signal);
            return [{ id: claim.id, status: 'completed', output: { operationId: operation.id } }];
          } catch (error) {
            const code = error instanceof TerminalJobFailure ? error.code : error instanceof LostJobClaim ? 'lease-lost' : 'handler-failed';
            console.error(`Durable job ${claim.id} in ${queueNames[kind]} failed (${code}); private provider details are not logged.`);
            return [{ id: claim.id, status: error instanceof TerminalJobFailure ? 'deadletter' : 'failed', output: { code } }];
          }
        });
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async deadLetters() {
    const [stats] = await this.boss.getQueueStats(deadLetterQueue, { force: true });
    if (!stats) throw new Error('Durable dead-letter statistics are unavailable.');
    return { queued: stats.queuedCount, failed: stats.failedCount, oldestReadySeconds: stats.readyOldestSeconds, capturedAt: stats.capturedOn.toISOString() };
  }
  close(): Promise<void> {
    return this.closing ??= this.boss.stop({ graceful: true, timeout: 10000 });
  }
}
