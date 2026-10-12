import { z } from 'zod';

export const sandboxUsagePolicy = 'sandbox-ai-usage-v1' as const;
export const usageKinds = ['tutor', 'feedback', 'mock', 'project'] as const;
export const instant = z.number().int().nonnegative().max(253402300799999);
export const amount = z.number().int().nonnegative().max(1000000000000);
export const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
export const evidenceSchema = z.strictObject({ actor: identifier, reason: z.string().trim().min(10).max(500) });
export const usagePolicySchema = z.strictObject({
  id: z.literal(sandboxUsagePolicy),
  monthlyUnits: z.number().int().min(1).max(100000),
  costs: z.strictObject({ tutor: z.number().int().positive(), feedback: z.number().int().positive(),
    mock: z.number().int().positive(), project: z.number().int().positive() }),
  dailyCostMicros: amount.refine(value => value > 0),
  monthlyCostMicros: amount.refine(value => value > 0),
  globalConcurrency: z.number().int().min(1).max(20),
  ownerConcurrency: z.number().int().min(1).max(20),
  maxQueueAgeMs: z.number().int().min(1000).max(300000),
}).refine(policy => Object.values(policy.costs).every(cost => cost <= policy.monthlyUnits) &&
  policy.dailyCostMicros <= policy.monthlyCostMicros && policy.ownerConcurrency <= policy.globalConcurrency,
'Usage policy costs, ceilings and concurrency must be coherent.');
export type UsagePolicy = z.infer<typeof usagePolicySchema>;
export const reservationRequestSchema = z.strictObject({
  owner: z.uuid(), key: z.uuid(), authEpoch: z.number().int().nonnegative().safe(),
  kind: z.enum(usageKinds), inputRef: identifier, inputRevision: z.number().int().nonnegative().safe(),
  inputHash: fingerprint, costCeilingMicros: amount.refine(value => value > 0),
  consent: z.literal(sandboxUsagePolicy), acknowledged: z.literal(true), evidence: evidenceSchema,
});
export type ReservationRequest = z.input<typeof reservationRequestSchema>;
export const completionSchema = z.strictObject({ resultHash: fingerprint, actualCostMicros: amount, evidence: evidenceSchema });
export const releaseSchema = z.strictObject({ actualCostMicros: amount, reconciled: z.literal(true).optional(), evidence: evidenceSchema });
export const reservationRowSchema = z.object({
  id: z.uuid(), owner_ref: z.uuid(), user_id: z.uuid().nullable(), request_key: z.uuid(), window_id: z.uuid(),
  policy_id: z.literal(sandboxUsagePolicy), request_payload: z.string(), request_hash: fingerprint,
  units: z.coerce.number().int().positive(), cost_ceiling: z.coerce.number().pipe(amount),
  state: z.enum(['reserved', 'dispatched', 'unknown', 'consumed', 'released']),
  created_at: z.date(), dispatched_at: z.date().nullable(), finished_at: z.date().nullable(),
  result_hash: fingerprint.nullable(), actual_cost: z.coerce.number().pipe(amount).nullable(), settlement_hash: fingerprint.nullable(),
});
export type ReservationRow = z.infer<typeof reservationRowSchema>;
export const windowRowSchema = z.object({
  id: z.uuid(), owner_ref: z.uuid(), lineage_id: z.uuid(), policy_id: z.literal(sandboxUsagePolicy),
  starts_at: z.coerce.number().pipe(instant), ends_at: z.coerce.number().pipe(instant),
  unit_limit: z.coerce.number().int().positive(), reserved: z.coerce.number().int().nonnegative(),
  consumed: z.coerce.number().int().nonnegative(),
});
export const budgetRowSchema = z.object({
  kind: z.enum(['day', 'month']), starts_at: z.coerce.number().pipe(instant), ends_at: z.coerce.number().pipe(instant),
  policy_id: z.literal(sandboxUsagePolicy), cost_limit: z.coerce.number().pipe(amount),
  reserved: z.coerce.number().pipe(amount), consumed: z.coerce.number().pipe(amount),
});

export const sandboxInputPolicy = 'sandbox-ai-input-v1' as const;
const modelSchema = z.strictObject({ id: identifier, revision: identifier });
const promptSchema = z.strictObject({ version: identifier, text: z.string().min(1).max(8000) });
export const inputPolicySchema = z.strictObject({
  id: z.literal(sandboxInputPolicy), model: modelSchema,
  prompts: z.strictObject({ tutor: promptSchema, feedback: promptSchema, mock: promptSchema, project: promptSchema }),
  maxInputBytes: z.number().int().min(1000).max(131072),
});
export type InputPolicy = z.input<typeof inputPolicySchema>;
export const inputRequestSchema = reservationRequestSchema.omit({
  inputRef: true, inputRevision: true, inputHash: true, costCeilingMicros: true,
}).extend({ sourceId: identifier, expectedRevision: z.number().int().min(0).max(2147483647) });
export type InputRequest = z.input<typeof inputRequestSchema>;
export const inputCommandSchema = z.strictObject({ request: inputRequestSchema, costCeilingMicros: amount.refine(value => value > 0) });
export const inputEnvelopeSchema = z.strictObject({
  authority: z.literal(sandboxInputPolicy), policyHash: fingerprint, model: modelSchema,
  prompt: promptSchema.extend({ hash: fingerprint }),
  source: z.strictObject({ kind: z.enum(usageKinds), id: identifier, revision: z.number().int().nonnegative(),
    hash: fingerprint, contentVersion: fingerprint.nullable() }),
  data: z.record(z.string(), z.json()),
});
export const inputRowSchema = z.object({
  id: z.uuid(), owner_ref: z.uuid(), user_id: z.uuid().nullable(), request_key: z.uuid(),
  request_payload: z.string(), request_hash: fingerprint, policy_id: z.literal(sandboxInputPolicy),
  reservation_id: z.uuid(), kind: z.enum(usageKinds), source_id: identifier,
  source_revision: z.number().int().nonnegative(), source_hash: fingerprint,
  input_hash: fingerprint, payload: z.string().nullable(), created_at: z.date(),
});
