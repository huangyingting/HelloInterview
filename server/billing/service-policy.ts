import { z } from 'zod';
import { sandboxServicePolicy, serviceReviewReasons, type ServiceReviewReason } from '../../shared/billing-ledger';
import type { SandboxOffer } from '../../shared/billing';
import { checkoutRowSchema, type CheckoutRow } from './checkout-schema';
import { invoiceFactSchema, subscriptionFactSchema, type InvoiceFact, type SubscriptionFact } from './ledger-schema';
import { digest, encodePayload } from '../jobs/schema';
import { cardSettlementEstablished } from './payment-schema';

const instant = z.number().int().nonnegative().max(253402300799999);
export const serviceEvidenceSchema = z.strictObject({
  policy: z.literal(sandboxServicePolicy), state: z.enum(['held', 'granted', 'revoked']),
  startsAt: instant.nullable(), endsAt: instant.nullable(), proof: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  reviewReasons: z.array(z.enum(serviceReviewReasons)).max(serviceReviewReasons.length),
}).refine(value => value.proof === null ? value.state !== 'granted' && value.startsAt === null && value.endsAt === null :
  value.state !== 'held' && value.startsAt !== null && value.endsAt !== null &&
  value.endsAt > value.startsAt && value.endsAt - value.startsAt <= 400 * 86400000, 'Service authority requires coherent immutable interval evidence.');
export type ServiceEvidence = z.infer<typeof serviceEvidenceSchema>;
export interface ServiceEvaluation {
  decision: 'held' | 'eligible' | 'revoke';
  startsAt: number | null; endsAt: number | null; proof: string | null;
  reviewReasons: ServiceReviewReason[];
}

export function calendarServiceEnd(start: number, anchor: number, offer: SandboxOffer): number | null {
  const date = new Date(start * 1000), base = new Date(anchor * 1000);
  const days = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (start < anchor || date.getUTCDate() !== Math.min(base.getUTCDate(), days(date.getUTCFullYear(), date.getUTCMonth())) ||
    date.getUTCHours() !== base.getUTCHours() || date.getUTCMinutes() !== base.getUTCMinutes() || date.getUTCSeconds() !== base.getUTCSeconds() ||
    offer === 'pro_annual' && date.getUTCMonth() !== base.getUTCMonth()) return null;
  date.setUTCDate(1);
  if (offer === 'pro_annual') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(Math.min(base.getUTCDate(), days(date.getUTCFullYear(), date.getUTCMonth())));
  const result = date.getTime();
  return Number.isSafeInteger(result) && result <= 253402300799999 ? result : null;
}

export function evaluateSandboxService(rawInvoice: InvoiceFact, rawSub: SubscriptionFact | undefined,
  rawAttempt: CheckoutRow | undefined, customerRef: string, globalReasons: readonly string[]): ServiceEvaluation {
  const invoice = invoiceFactSchema.parse(rawInvoice), sub = rawSub ? subscriptionFactSchema.parse(rawSub) : undefined,
    attempt = rawAttempt ? checkoutRowSchema.parse(rawAttempt) : undefined;
  const reasons = new Set<ServiceReviewReason>();
  if (invoice.funding?.refunded) reasons.add('payment-reversed');
  if (invoice.funding?.charges.some(charge => charge.disputes.length)) reasons.add('payment-disputed');
  if (invoice.funding?.credits.some(credit => credit.status === 'issued')) reasons.add('credit-adjustment');
  if (reasons.size) return { decision: 'revoke', startsAt: null, endsAt: null, proof: null, reviewReasons: [...reasons].sort() };
  if (!attempt || attempt.customer_ref !== customerRef || attempt.state !== 'complete' ||
    attempt.subscription_id !== invoice.subscriptionId || attempt.id !== sub?.attemptId) reasons.add('checkout-unverified');
  if (!sub || sub.id !== invoice.subscriptionId || !['active', 'past_due', 'unpaid', 'paused', 'canceled'].includes(sub.status) ||
    sub.items.length !== 1 || sub.reviewReasons.length) reasons.add('subscription-unverified');
  if (invoice.status !== 'paid' || invoice.paidAt === null || !['subscription_create', 'subscription_cycle'].includes(invoice.billingReason ?? '') ||
    invoice.collectionMethod !== 'charge_automatically') reasons.add('invoice-unsupported');
  if (!invoice.funding || invoice.funding.state !== 'settled' || invoice.funding.version !== 'sandbox-card-evidence-v1' ||
    invoice.funding.currency !== invoice.currency || invoice.funding.captured !== invoice.total ||
    !cardSettlementEstablished(invoice, invoice.funding.intents, invoice.funding.charges) ||
    invoice.funding.charges.some(charge => charge.refunds.some(refund => ['pending', 'requires_action'].includes(refund.status)))) reasons.add('funding-ineligible');
  if (invoice.reviewReasons.some(reason => reason !== 'commercial-policy-pending') ||
    globalReasons.some(reason => ['duplicate-subscriptions', 'payment-lifecycle-unverified'].includes(reason))) reasons.add('provider-review');
  const line = invoice.lines.length === 1 ? invoice.lines[0] : undefined, item = sub?.items.length === 1 ? sub.items[0] : undefined;
  if (!line || line.subscriptionId !== sub?.id || !line.itemId || line.itemId !== item?.id ||
    line.quantity !== 1 || line.quantityDecimal !== '1' || line.proration !== false || item?.quantity !== 1) reasons.add('line-unsupported');
  if (!attempt || attempt.currency !== 'usd' || !attempt.unit_amount || invoice.currency !== attempt.currency ||
    invoice.total !== attempt.unit_amount || invoice.amountPaid !== invoice.total || invoice.amountRemaining !== 0 ||
    !line || line.priceId !== attempt.price_id || item?.priceId !== attempt.price_id ||
    line.currency !== invoice.currency || line.amount !== invoice.total) reasons.add('price-or-amount-mismatch');
  const startsAt = line ? line.periodStart * 1000 : null, endsAt = line ? (line.periodEnd + 1) * 1000 : null;
  if (!line || !sub || !attempt || sub.billingCycleAnchor === null || sub.anchorConfigured !== false ||
    calendarServiceEnd(line.periodStart, sub.billingCycleAnchor, attempt.offer_key) !== endsAt ||
    endsAt === null || startsAt === null || endsAt <= startsAt || endsAt - startsAt > 400 * 86400000 ||
    sub.latestInvoiceId === invoice.id && (line.periodStart !== item?.periodStart || line.periodEnd + 1 !== item?.periodEnd)) {
    reasons.add('calendar-period-unsupported');
  }
  if (reasons.size || !line || !attempt || !sub || startsAt === null || endsAt === null) {
    return { decision: 'held', startsAt: null, endsAt: null, proof: null, reviewReasons: [...reasons].sort() };
  }
  const proof = digest(encodePayload({ policy: sandboxServicePolicy, invoiceId: invoice.id, subscriptionId: sub.id,
    checkoutId: attempt.id, offer: attempt.offer_key, priceId: attempt.price_id, lineId: line.id, itemId: line.itemId,
    currency: invoice.currency, total: invoice.total, paidAt: invoice.paidAt, startsAt, endsAt,
    intentIds: invoice.funding?.intents.map(intent => intent.id), chargeIds: invoice.funding?.charges.map(charge => charge.id) }));
  return { decision: 'eligible', startsAt, endsAt, proof, reviewReasons: [] };
}
