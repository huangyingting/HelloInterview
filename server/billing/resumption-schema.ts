import { z } from 'zod';
import { sandboxResumptionAuthority } from '../../shared/billing-ledger';
import { sandboxOffers } from '../../shared/billing';
import { providerId } from './schema';
import { seconds } from './ledger-schema';

export const resumptionRequestSchema = z.strictObject({ cancellationId: z.uuid(), acknowledged: z.literal(true) });
export type ResumptionRequest = z.infer<typeof resumptionRequestSchema>;
export const resumptionOperationSchema = z.strictObject({
  policy: z.literal(sandboxResumptionAuthority), id: z.uuid(), cancellationId: z.uuid(),
  customerRef: z.uuid(), subscriptionRef: z.uuid(), subscriptionId: providerId, attemptId: z.uuid(),
  priceId: providerId, offer: z.enum(sandboxOffers), currency: z.literal('usd'),
  unitAmount: z.number().int().positive().safe(), itemId: providerId, periodStart: seconds, periodEnd: seconds,
  billingAnchor: seconds,
  invoiceId: providerId, eligibilityProof: z.string().regex(/^[a-f0-9]{64}$/), acknowledged: z.literal(true),
  authEpoch: z.number().int().nonnegative().safe(),
}).refine(value => value.periodEnd > value.periodStart, 'Resumption requires a coherent captured current interval.');
export type ResumptionOperation = z.infer<typeof resumptionOperationSchema>;
export const resumptionRowSchema = z.object({
  id: z.uuid(), policy_version: z.literal(sandboxResumptionAuthority), cancellation_id: z.uuid(),
  customer_ref: z.uuid(), subscription_ref: z.uuid(), attempt_id: z.uuid(), auth_epoch: z.coerce.number().int().nonnegative().safe(),
  price_id: providerId, offer_key: z.enum(sandboxOffers), currency: z.literal('usd'), unit_amount: z.coerce.number().int().positive().safe(),
  item_id: providerId, period_start: z.coerce.number().int().nonnegative().safe(), period_end: z.coerce.number().int().nonnegative().safe(),
  billing_anchor: z.coerce.number().int().nonnegative().safe(),
  invoice_id: providerId, eligibility_proof: z.string().regex(/^[a-f0-9]{64}$/), acknowledged: z.literal(1),
  operation_id: z.uuid(), state: z.enum(['queued', 'confirmed']), created_at: z.date(),
  confirmed_at: z.date().nullable(), result: z.literal('renewing').nullable(),
}).refine(row => row.period_end > row.period_start && (row.state === 'queued' ? row.confirmed_at === null && row.result === null :
  row.confirmed_at !== null && row.result === 'renewing'), 'Resumption confirmation requires coherent canonical evidence.');
export type ResumptionRow = z.infer<typeof resumptionRowSchema>;
