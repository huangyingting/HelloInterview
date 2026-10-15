import type { Database } from '../db/connection';
import { HttpError } from '../http-error';
import { DurableJobs, LostJobClaim, type JobClaim } from '../jobs';
import { SandboxInputs, SandboxUsage } from '../usage';
import type { ManagedAiConfig } from './config';
import { ManagedAiProvider } from './provider';

const dispatchedEvidence = {
  actor: 'managed-ai-worker',
  reason: 'The bounded managed AI provider request started for this exact native intent.',
};
const unknownEvidence = {
  actor: 'managed-ai-worker',
  reason: 'The managed AI provider or publication outcome requires explicit reconciliation.',
};
const cancelledEvidence = {
  actor: 'managed-ai-worker',
  reason: 'The native intent was not dispatched because its saved admission was no longer valid.',
};
const completionEvidence = {
  actor: 'managed-ai-worker',
  reason: 'The validated managed AI result and measured provider usage were published atomically.',
};

export interface ManagedAiProviderClient {
  evaluate: ManagedAiProvider['evaluate'];
}

export class ManagedAiWorker {
  private constructor(
    private readonly db: Database,
    readonly usage: SandboxUsage,
    readonly inputs: SandboxInputs,
    readonly jobs: DurableJobs,
    private readonly provider: ManagedAiProviderClient,
  ) {}

  static async open(
    db: Database,
    config: ManagedAiConfig,
    provider: ManagedAiProviderClient = new ManagedAiProvider(config.provider),
  ) {
    const usage = await SandboxUsage.open(db, config.usage);
    const inputs = await SandboxInputs.open(db, config.input);
    const jobs = await DurableJobs.open(db, true);
    return new ManagedAiWorker(db, usage, inputs, jobs, provider);
  }

  async runClaim(claim: JobClaim, signal?: AbortSignal) {
    const operation = await this.jobs.assertReservedAiClaim(this.usage, claim, signal);
    const admission = await this.usage.assertNativeOperation(operation);
    if (admission.state === 'dispatched' || admission.state === 'unknown') {
      if (admission.state === 'dispatched') {
        await this.usage.markNativeUnknown(this.db, operation, unknownEvidence);
      }
      await this.jobs.fail(claim, 'reconciliation-required');
      return { state: 'unknown' as const, operationId: operation.id };
    }
    if (admission.state !== 'reserved') {
      throw new LostJobClaim();
    }
    let dispatched = false;
    try {
      const prepared = await this.inputs.prepare(this.usage, this.jobs, admission.owner, operation.id);
      await this.usage.markNativeDispatched(this.db, operation, dispatchedEvidence);
      dispatched = true;
      await this.jobs.assertReservedAiClaim(this.usage, claim, signal);
      const completion = await this.provider.evaluate(prepared.input, signal);
      let publication: { kind: string; sourceId: string; revision: number } | undefined;
      await this.jobs.finishReservedAi(this.usage, claim, async (db, current) => {
        await this.usage.completeNative(db, current, {
          resultHash: completion.resultHash,
          actualCostMicros: completion.actualCostMicros,
          evidence: completionEvidence,
        }, async () => {
          publication = await this.inputs.publish(admission.owner, current.id, completion.result);
        });
        if (!publication) throw new Error('Managed AI publication did not produce a receipt.');
        return { status: 'published', ...publication, resultHash: completion.resultHash };
      }, signal);
      return { state: 'completed' as const, operationId: operation.id };
    } catch (error) {
      if (!dispatched && error instanceof HttpError) {
        await this.jobs.cancelReservedAi(this.usage, admission.owner, admission.reservationId, cancelledEvidence);
        return { state: 'cancelled' as const, operationId: operation.id };
      }
      if (dispatched) {
        await this.usage.markNativeUnknown(this.db, operation, unknownEvidence);
        await this.jobs.fail(claim, 'reconciliation-required');
        return { state: 'unknown' as const, operationId: operation.id };
      }
      throw error;
    }
  }

  async processNext(signal?: AbortSignal) {
    const claim = await this.jobs.claim('ai.evaluate');
    return claim ? this.runClaim(claim, signal) : null;
  }

  close() {
    return this.jobs.close();
  }
}
