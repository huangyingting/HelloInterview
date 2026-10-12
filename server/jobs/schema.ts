import { createHash } from 'node:crypto';
import { z } from 'zod';

export const jobKinds = ['billing.reconcile', 'billing.customer', 'billing.checkout', 'billing.checkout.refresh', 'billing.customer.snapshot', 'notification.deliver', 'ai.evaluate', 'privacy.process', 'identity.reconcile'] as const;
export const queueNames = {
  'billing.reconcile': 'billing-reconcile',
  'billing.customer': 'billing-customer',
  'billing.checkout': 'billing-checkout',
  'billing.checkout.refresh': 'billing-checkout-refresh',
  'billing.customer.snapshot': 'billing-customer-snapshot',
  'notification.deliver': 'notification-deliver',
  'ai.evaluate': 'ai-evaluate',
  'privacy.process': 'privacy-process',
  'identity.reconcile': 'identity-reconcile',
} as const;
export const deadLetterQueue = 'dead-letter';
export const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
export const kindSchema = z.enum(jobKinds);
export const retryModeSchema = z.enum(['idempotent', 'reconcile']);
const jsonSchema = z.json();
const payloadSchema = z.record(z.string(), jsonSchema);
export type Payload = z.infer<typeof payloadSchema>;

export const requestSchema = z.strictObject({
  principal: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('user'), id: identifier }),
    z.strictObject({ type: z.literal('system'), id: identifier }),
  ]),
  kind: kindSchema,
  key: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  resource: identifier,
  payload: z.unknown(),
  retryMode: retryModeSchema,
});
export type OperationRequest = z.infer<typeof requestSchema>;
export const eventSchema = z.strictObject({
  source: identifier,
  eventId: identifier,
  payload: z.unknown(),
  operation: requestSchema.omit({ principal: true, key: true }),
});
export type VerifiedEvent = z.infer<typeof eventSchema>;
export class InvalidJobPayload extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidJobPayload'; }
}

function canonical(value: z.infer<typeof jsonSchema>): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new InvalidJobPayload('A job payload contains a non-JSON value.');
  return encoded;
}
export function encodePayload(value: unknown, maxBytes = 262144): string {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 16384 || item.depth > 24) throw new InvalidJobPayload('A job payload exceeds the JSON complexity limit.');
    if (item.value !== null && typeof item.value === 'object') {
      const prototype = Object.getPrototypeOf(item.value);
      if (Array.isArray(item.value) ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) {
        throw new InvalidJobPayload('A job payload must contain plain JSON values.');
      }
      if (Object.keys(item.value).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) {
        throw new InvalidJobPayload('A job payload contains a prohibited object key.');
      }
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  const encoded = canonical(payloadSchema.parse(value));
  if (Buffer.byteLength(encoded) > maxBytes) throw new InvalidJobPayload('A job payload exceeds its byte limit.');
  return encoded;
}
export function payloadFromBytes(bytes: string, maxBytes = 262144): Payload {
  if (Buffer.byteLength(bytes) > maxBytes) throw new Error('Saved job payload exceeds its byte limit.');
  const value: unknown = JSON.parse(bytes);
  if (encodePayload(value, maxBytes) !== bytes) throw new Error('Saved job payload bytes are not canonical.');
  return payloadSchema.parse(value);
}
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function requestDigest(scope: string, request: Pick<OperationRequest, 'kind' | 'resource' | 'retryMode'>, payload: string): string {
  return digest(canonical({ scope, kind: request.kind, resource: request.resource, retryMode: request.retryMode, payload }));
}
export const operationRowSchema = z.strictObject({
  id: z.uuid(), scope: z.string().min(1).max(210), kind: kindSchema,
  owner_id: identifier.nullable(), request_key: z.string().min(1).max(160),
  request_hash: z.string().regex(/^[a-f0-9]{64}$/), resource: identifier,
  payload: z.string(), retry_mode: retryModeSchema, job_id: z.uuid(),
  generation: z.number().int().nonnegative(), created_at: z.date(),
  completed_at: z.date().nullable(), receipt: z.string().nullable(),
});
export type Operation = {
  id: string; kind: z.infer<typeof kindSchema>; ownerId: string | null; resource: string;
  principal: { type: 'user' | 'system'; id: string };
  retryMode: z.infer<typeof retryModeSchema>; jobId: string; generation: number;
  payload: Payload; createdAt: string; completedAt: string | null; receipt: Payload | null;
};
export function readOperation(value: unknown): Operation {
  const row = operationRowSchema.parse(value);
  const type = row.scope.startsWith('user:') ? 'user' : row.scope.startsWith('system:') ? 'system' : null;
  if (!type) throw new Error('Saved job principal is inconsistent.');
  const principalId = identifier.parse(row.scope.slice(type.length + 1));
  if (type === 'system' && row.owner_id !== null || type === 'user' && row.owner_id !== null && row.owner_id !== principalId) {
    throw new Error('Saved job ownership is inconsistent.');
  }
  if (requestDigest(row.scope, { kind: row.kind, resource: row.resource, retryMode: row.retry_mode }, row.payload) !== row.request_hash) {
    throw new Error('Saved job input does not match its request hash.');
  }
  if ((row.completed_at === null) !== (row.receipt === null)) throw new Error('Saved job completion is inconsistent.');
  return {
    id: row.id, kind: row.kind, ownerId: row.owner_id, resource: row.resource,
    principal: { type, id: principalId },
    retryMode: row.retry_mode, jobId: row.job_id, generation: row.generation,
    payload: payloadFromBytes(row.payload), createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    receipt: row.receipt === null ? null : payloadFromBytes(row.receipt, 16384),
  };
}
export const claimDataSchema = z.strictObject({ operationId: z.uuid(), generation: z.number().int().nonnegative() });
export type ClaimData = z.infer<typeof claimDataSchema>;
