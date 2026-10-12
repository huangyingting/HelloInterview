import { z } from 'zod';
import { billingReviewReasons, fundingStates } from '../../shared/billing-ledger';
import { providerId } from './schema';

const amount = z.number().int().nonnegative().safe(), currency = z.string().regex(/^[a-z]{3}$/);
export const allocationSchema = z.strictObject({
  id: providerId, invoiceId: providerId, status: z.enum(['open', 'paid', 'canceled']), amountPaid: amount.nullable(),
});
export const intentFactSchema = z.strictObject({
  id: providerId, currency, status: z.enum(['canceled', 'processing', 'requires_action', 'requires_capture', 'requires_confirmation', 'requires_payment_method', 'succeeded']),
  amount: amount, received: amount, capturable: amount, latestCharge: providerId.nullable(),
  allocations: z.array(allocationSchema).max(500),
});
export const chargeFactSchema = z.strictObject({
  id: providerId, currency, intentId: providerId.nullable(), amount: amount, capturedAmount: amount, refundedAmount: amount,
  status: z.enum(['succeeded', 'failed', 'pending']), paid: z.boolean(), captured: z.boolean(), method: z.string().max(50).nullable(),
  refunds: z.array(z.strictObject({ id: providerId, amount: amount, status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']) })).max(500),
  disputes: z.array(z.strictObject({ id: providerId, amount: amount,
    status: z.enum(['lost', 'needs_response', 'prevented', 'under_review', 'warning_closed', 'warning_needs_response', 'warning_under_review', 'won']) })).max(500),
});
export const creditFactSchema = z.strictObject({ id: providerId, amount: amount, status: z.enum(['issued', 'void']) });
export const fundingEvidenceSchema = z.strictObject({
  version: z.literal('sandbox-card-evidence-v1'), state: z.enum(fundingStates), captured: amount, refunded: amount,
  currency, intents: z.array(intentFactSchema).max(500), charges: z.array(chargeFactSchema).max(500),
  credits: z.array(creditFactSchema).max(500), reviewReasons: z.array(z.enum(billingReviewReasons)).max(billingReviewReasons.length),
});
export type FundingEvidence = z.infer<typeof fundingEvidenceSchema>;
