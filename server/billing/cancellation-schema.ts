import { z } from 'zod';
import { sandboxRenewalAuthority, sandboxRenewalCycleAuthority } from '../../shared/billing-ledger';
import { providerId } from './schema';

const cancellationFields = {
  id: z.uuid(), customerRef: z.uuid(), subscriptionRef: z.uuid(),
  subscriptionId: providerId, attemptId: z.uuid(), priceId: providerId, authEpoch: z.number().int().nonnegative().safe(),
};
export const cancellationRequestSchema = z.union([z.strictObject({}), z.strictObject({ previousResumptionId: z.uuid() })]);
export type CancellationRequest = z.infer<typeof cancellationRequestSchema>;
export const cancellationOperationSchema = z.discriminatedUnion('policy', [
  z.strictObject({ ...cancellationFields, policy: z.literal(sandboxRenewalAuthority) }),
  z.strictObject({ ...cancellationFields, policy: z.literal(sandboxRenewalCycleAuthority),
    cycle: z.number().int().positive().safe(), previousResumptionId: z.uuid() }),
]);
export const cancellationRowSchema = z.object({
  id: z.uuid(), policy_version: z.enum([sandboxRenewalAuthority, sandboxRenewalCycleAuthority]), customer_ref: z.uuid(),
  cycle: z.coerce.number().int().nonnegative().safe(), previous_resumption_id: z.uuid().nullable(),
  subscription_ref: z.uuid(), attempt_id: z.uuid(), auth_epoch: z.coerce.number().int().nonnegative().safe(),
  operation_id: z.uuid(), state: z.enum(['queued', 'confirmed']), created_at: z.date(),
  confirmed_at: z.date().nullable(), result: z.enum(['nonrenewing', 'ended']).nullable(),
}).refine(row => row.cycle === 0 ? row.previous_resumption_id === null && row.policy_version === sandboxRenewalAuthority :
  row.previous_resumption_id !== null && row.policy_version === sandboxRenewalCycleAuthority, 'Cancellation cycles require an exact predecessor authority.')
  .refine(row => row.state === 'queued' ? row.confirmed_at === null && row.result === null :
    row.confirmed_at !== null && row.result !== null, 'Cancellation confirmation requires canonical evidence.');
export type CancellationRow = z.infer<typeof cancellationRowSchema>;
