import { z } from 'zod';
import { sandboxRenewalAuthority } from '../../shared/billing-ledger';
import { providerId } from './schema';

export const cancellationOperationSchema = z.strictObject({
  policy: z.literal(sandboxRenewalAuthority), id: z.uuid(), customerRef: z.uuid(), subscriptionRef: z.uuid(),
  subscriptionId: providerId, attemptId: z.uuid(), priceId: providerId, authEpoch: z.number().int().nonnegative().safe(),
});
export const cancellationRowSchema = z.object({
  id: z.uuid(), policy_version: z.literal(sandboxRenewalAuthority), customer_ref: z.uuid(),
  subscription_ref: z.uuid(), attempt_id: z.uuid(), auth_epoch: z.coerce.number().int().nonnegative().safe(),
  operation_id: z.uuid(), state: z.enum(['queued', 'confirmed']), created_at: z.date(),
  confirmed_at: z.date().nullable(), result: z.enum(['nonrenewing', 'ended']).nullable(),
}).refine(row => row.state === 'queued' ? row.confirmed_at === null && row.result === null :
  row.confirmed_at !== null && row.result !== null, 'Cancellation confirmation requires canonical evidence.');
export type CancellationRow = z.infer<typeof cancellationRowSchema>;
