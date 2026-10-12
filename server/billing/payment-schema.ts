import { z } from 'zod';
import { billingReviewReasons, fundingStates } from '../../shared/billing-ledger';
import { providerId } from './schema';
import type { InvoiceFact } from './ledger-schema';

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

export function cardSettlementEstablished(invoice: InvoiceFact, intents: FundingEvidence['intents'], charges: FundingEvidence['charges']) {
  const paid = invoice.payments.filter(payment => payment.status === 'paid'),
    primary = charges.filter(charge => charge.status === 'succeeded' && charge.paid && charge.captured),
    allocations = intents.length === 1 ? intents[0].allocations.filter(allocation => allocation.status !== 'canceled') : [];
  return invoice.status === 'paid' && invoice.paidAt !== null && invoice.total > 0 && invoice.amountRemaining === 0 &&
    invoice.amountPaid === invoice.total && paid.length === 1 && paid[0].type === 'payment_intent' && paid[0].amountPaid === invoice.total &&
    paid[0].currency === invoice.currency && intents.length === 1 && intents[0].status === 'succeeded' &&
    intents[0].currency === invoice.currency && intents[0].amount === invoice.total && intents[0].received === invoice.total &&
    intents[0].capturable === 0 && paid[0].reference === intents[0].id && allocations.length === 1 &&
    allocations[0].id === paid[0].id && allocations[0].invoiceId === invoice.id && allocations[0].status === 'paid' && allocations[0].amountPaid === invoice.total &&
    primary.length === 1 && primary[0].id === intents[0].latestCharge && primary[0].intentId === intents[0].id &&
    primary[0].currency === invoice.currency && primary[0].method === 'card' && primary[0].amount === invoice.total &&
    charges.reduce((amount, charge) => amount + charge.capturedAmount, 0) === invoice.total;
}
