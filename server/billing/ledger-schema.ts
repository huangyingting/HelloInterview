import { z } from 'zod';
import { billingReviewReasons } from '../../shared/billing-ledger';
import { providerId } from './schema';

export const ledgerOperationSchema = z.strictObject({
  accountId: providerId, customerRef: z.uuid(), customerId: providerId, revision: z.number().int().positive().safe(),
});
export const revision = z.coerce.number().int().nonnegative().safe();
export const ledgerStateSchema = z.object({
  requested_revision: revision, reconciled_revision: revision, operation_id: z.uuid().nullable(),
  observed_at: z.date().nullable(), snapshot: z.string().nullable(),
});
export const seconds = z.number().int().nonnegative().max(253402300799);
export const money = z.number().int().safe();
const currency = z.string().regex(/^[a-z]{3}$/), reasons = z.array(z.enum(billingReviewReasons)).max(billingReviewReasons.length);
export const subscriptionFactSchema = z.strictObject({
  id: providerId, status: z.enum(['active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid']),
  cancelAtPeriodEnd: z.boolean(), latestInvoiceId: providerId.nullable(), attemptId: z.uuid().nullable(),
  items: z.array(z.strictObject({ id: providerId, priceId: providerId, quantity: z.number().int().nonnegative().nullable(),
    periodStart: seconds, periodEnd: seconds })).max(500),
  reviewReasons: reasons,
});
export const invoiceFactSchema = z.strictObject({
  id: providerId, subscriptionId: providerId.nullable(), status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  currency, created: seconds, total: money, amountPaid: money.nonnegative(), amountRemaining: money.nonnegative(), paidAt: seconds.nullable(),
  lines: z.array(z.strictObject({
    id: providerId, priceId: providerId.nullable(), subscriptionId: providerId.nullable(), amount: money, currency,
    quantity: z.number().int().nonnegative().nullable(), quantityDecimal: z.string().max(40).nullable(),
    periodStart: seconds, periodEnd: seconds, proration: z.boolean().nullable(),
  })).max(500),
  payments: z.array(z.strictObject({
    id: providerId, status: z.enum(['open', 'paid', 'canceled']), type: z.enum(['charge', 'payment_intent', 'payment_record']),
    reference: providerId, amountPaid: money.nonnegative().nullable(), currency,
  })).max(500),
  reviewReasons: reasons,
});
export const ledgerSnapshotSchema = z.strictObject({
  scope: z.literal('recent-90-days-and-known-targets-v1'), since: seconds,
  subscriptions: z.array(subscriptionFactSchema).max(500), invoices: z.array(invoiceFactSchema).max(500), reviewReasons: reasons,
});
export type LedgerSnapshot = z.infer<typeof ledgerSnapshotSchema>;
export type SubscriptionFact = z.infer<typeof subscriptionFactSchema>;
export type InvoiceFact = z.infer<typeof invoiceFactSchema>;
