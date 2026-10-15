import { z } from 'zod';
import { loadManagedAiConfig } from '../ai/config';
import { loadAuthSettings } from '../auth/config';
import { assertCsrf } from '../auth/csrf';
import { currentManagedAuthSession } from '../auth/session';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { IdentityLimits } from '../identity/limits';
import { DurableJobs } from '../jobs';
import { SandboxInputs, SandboxUsage, sandboxUsagePolicy, type InputRequest } from '../usage';
import { assertAccountSession } from './identity';

const activeStatus = ['active'] as const;
const requestSchema = z.strictObject({
  requestId: z.uuid(),
  revision: z.number().int().nonnegative().max(2147483647),
  consent: z.literal(sandboxUsagePolicy),
  acknowledged: z.literal(true),
});
const operationIdSchema = z.uuid();
function operationId(value: string) {
  const parsed = operationIdSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(404, 'Managed AI operation not found.');
  return parsed.data;
}

type AiService = {
  config: NonNullable<ReturnType<typeof loadManagedAiConfig>>;
  usage: SandboxUsage;
  inputs: SandboxInputs;
  jobs: DurableJobs;
};
let service: Promise<AiService> | undefined;

async function managedAiService() {
  if (service) return service;
  const pending = (async () => {
    const config = loadManagedAiConfig();
    if (!config) throw new HttpError(503, 'Managed AI is not configured.');
    const db = prismaConnection();
    return {
      config,
      usage: await SandboxUsage.open(db, config.usage),
      inputs: await SandboxInputs.open(db, config.input),
      jobs: await DurableJobs.open(db),
    };
  })();
  service = pending;
  try {
    return await pending;
  } catch (error) {
    if (service === pending) service = undefined;
    throw error;
  }
}

export async function closeNextAiService() {
  const current = service;
  service = undefined;
  if (current) await (await current).jobs.close();
}

export function nextAiCapability() {
  const config = loadManagedAiConfig();
  return config ? {
    model: config.input.model.id,
    notice: config.dataUseNotice,
    consent: config.usage.id,
    monthlyUnits: config.usage.monthlyUnits,
  } as const : null;
}

async function admission(request: Request, mutation: boolean, limited = mutation) {
  const [session, auth] = await Promise.all([currentManagedAuthSession(request), Promise.resolve(loadAuthSettings())]);
  if (!session) throw new HttpError(401, 'Sign in to use managed AI.');
  if (session.status !== 'active') throw new HttpError(403, 'This account is not available for managed AI.');
  if (!auth) throw new HttpError(503, 'Authentication is not configured.');
  if (mutation) assertCsrf(request, session);
  if (limited) {
    const decision = await new IdentityLimits(prismaConnection(), auth.secret).consume('ai', session.userId);
    if (!decision.allowed) {
      throw new HttpError(429, 'Too many managed AI requests. Wait before trying again.', {
        'Retry-After': String(decision.retryAfter),
      });
    }
  }
  return session;
}

export async function enqueueManagedAi(
  request: Request,
  kind: InputRequest['kind'],
  sourceId: string,
  input: unknown,
) {
  const body = requestSchema.safeParse(input);
  if (!body.success) {
    throw new HttpError(400, 'Confirm the current saved revision and managed AI data-use notice with a new request ID.');
  }
  const session = await admission(request, true);
  const db = prismaConnection();
  const ai = await managedAiService();
  return db.transaction(async () => {
    await assertAccountSession(db, session, false, activeStatus);
    const result = await ai.inputs.enqueue(ai.usage, ai.jobs, {
      owner: session.userId,
      key: body.data.requestId,
      authEpoch: session.epoch,
      kind,
      sourceId,
      expectedRevision: body.data.revision,
      consent: body.data.consent,
      acknowledged: body.data.acknowledged,
      evidence: {
        actor: 'participant',
        reason: 'The participant confirmed the managed AI data-use notice for this saved request.',
      },
    }, ai.config.costCeilingMicros);
    await assertAccountSession(db, session, false, activeStatus);
    return {
      operationId: result.operationId,
      reservationId: result.reservationId,
      state: 'queued' as const,
    };
  });
}

export async function managedAiOperation(request: Request, id: string) {
  const ownedOperationId = operationId(id);
  const session = await admission(request, false);
  const db = prismaConnection();
  const ai = await managedAiService();
  return db.transaction(async () => {
    await assertAccountSession(db, session, false, activeStatus);
    const status = await ai.jobs.ownedStatus(session.userId, ownedOperationId);
    const operation = await ai.jobs.operation(ownedOperationId);
    const usage = await ai.usage.assertNativeOperation(operation);
    await assertAccountSession(db, session, false, activeStatus);
    const state = usage.state === 'consumed' && operation.completedAt ? 'completed'
      : usage.state === 'released' ? 'cancelled'
        : usage.state === 'unknown' ? 'unknown'
          : status.status === 'active' || usage.state === 'dispatched' ? 'running'
            : ['failed', 'cancelled', 'missing'].includes(status.status) ? 'failed'
              : 'queued';
    const receipt = operation.receipt;
    return {
      operationId: ownedOperationId,
      kind: usage.kind,
      state,
      createdAt: status.createdAt,
      completedAt: status.completedAt,
      ...(state === 'completed' && receipt ? {
        result: {
          sourceId: typeof receipt.sourceId === 'string' ? receipt.sourceId : null,
          revision: typeof receipt.revision === 'number' ? receipt.revision : null,
        },
      } : {}),
    };
  });
}

export async function cancelManagedAiOperation(request: Request, id: string) {
  const ownedOperationId = operationId(id);
  const session = await admission(request, true);
  const db = prismaConnection();
  const ai = await managedAiService();
  return db.transaction(async () => {
    await assertAccountSession(db, session, false, activeStatus);
    await ai.jobs.ownedStatus(session.userId, ownedOperationId);
    const operation = await ai.jobs.operation(ownedOperationId);
    const usage = await ai.usage.assertNativeOperation(operation);
    await ai.jobs.cancelReservedAi(ai.usage, session.userId, usage.reservationId, {
      actor: 'participant',
      reason: 'The participant cancelled this known-undispatched managed AI request.',
    });
    await assertAccountSession(db, session, false, activeStatus);
    return { operationId: ownedOperationId, state: 'cancelled' as const };
  });
}
