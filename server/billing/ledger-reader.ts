import Stripe from 'stripe';
import { z } from 'zod';
import type { BillingReviewReason } from '../../shared/billing-ledger';
import { providerId, referenceId } from './schema';
import { invoiceFactSchema, ledgerSnapshotSchema, money, seconds, subscriptionFactSchema, type LedgerSnapshot } from './ledger-schema';
import { canonicalPages, canonicalPageSchema as pageSchema, consistent, type CanonicalRead } from './canonical-pages';
import { CanonicalPayments } from './payment-reader';
import { encodePayload } from '../jobs/schema';
export type { CanonicalRead } from './canonical-pages';

export interface LedgerReadInput {
  customerRef: string; customerId: string; since: number;
  attempts: { id: string; priceId: string; subscriptionId: string | null; state: string }[];
  knownSubscriptions: string[]; invoiceTargets: string[];
  chargeTargets: string[]; creditTargets: string[]; knownChargeLinks: { chargeId: string; invoiceId: string }[];
  serviceProof: boolean;
}
const ref = z.union([providerId, z.looseObject({ id: providerId })]);
const currency = z.string().regex(/^[a-z]{3}$/);
const sdkQuantity = z.custom<Stripe.Decimal>(value => typeof value === 'object' && value !== null &&
  Object.getPrototypeOf(value) === Object.getPrototypeOf(Stripe.Decimal.zero))
  .transform(value => value.toString()).pipe(z.string().regex(/^\d{1,20}(?:\.\d{1,12})?$/)).nullable();
const itemSchema = z.looseObject({
  id: providerId, object: z.literal('subscription_item'), subscription: providerId,
  price: z.looseObject({ id: providerId, object: z.literal('price'), livemode: z.literal(false) }),
  quantity: z.number().int().nonnegative().optional(), current_period_start: seconds, current_period_end: seconds,
});
const subscriptionSchema = z.looseObject({
  id: providerId, object: z.literal('subscription'), customer: ref, livemode: z.literal(false),
  status: subscriptionFactSchema.shape.status, cancel_at_period_end: z.boolean(), latest_invoice: ref.nullable(),
  billing_cycle_anchor: seconds.nullable().optional(), billing_cycle_anchor_config: z.unknown().optional(),
  metadata: z.record(z.string(), z.string()), items: pageSchema,
});
const invoiceSchema = z.looseObject({
  id: providerId, object: z.literal('invoice'), customer: ref, livemode: z.literal(false), created: seconds,
  status: invoiceFactSchema.shape.status, currency, total: money, amount_paid: money.nonnegative(), amount_remaining: money.nonnegative(),
  status_transitions: z.looseObject({ paid_at: seconds.nullable() }),
  billing_reason: z.string().max(50).nullable().optional(),
  collection_method: z.enum(['charge_automatically', 'send_invoice']).optional(),
  parent: z.looseObject({ type: z.enum(['subscription_details', 'quote_details']),
    subscription_details: z.looseObject({ subscription: ref }).nullable().optional() }).nullable(),
  lines: pageSchema, payments: pageSchema.optional(),
});
const lineSchema = z.looseObject({
  id: providerId, object: z.literal('line_item'), invoice: providerId, livemode: z.literal(false),
  currency, amount: money, quantity: z.number().int().nonnegative().nullable(),
  quantity_decimal: sdkQuantity,
  subscription: ref.nullable(), period: z.looseObject({ start: seconds, end: seconds }),
  parent: z.looseObject({
    type: z.enum(['invoice_item_details', 'subscription_item_details']),
    subscription_item_details: z.looseObject({ subscription: providerId, subscription_item: providerId, proration: z.boolean() }).nullable().optional(),
    invoice_item_details: z.looseObject({ proration: z.boolean() }).nullable().optional(),
  }).nullable(),
  pricing: z.looseObject({ type: z.literal('price_details'), price_details: z.looseObject({ price: ref }).optional() }).nullable(),
});
const paymentSchema = z.looseObject({
  id: providerId, object: z.literal('invoice_payment'), invoice: ref, livemode: z.literal(false),
  status: z.enum(['open', 'paid', 'canceled']), currency, amount_paid: money.nonnegative().nullable(),
  payment: z.looseObject({ type: z.enum(['charge', 'payment_intent', 'payment_record']),
    charge: ref.optional(), payment_intent: ref.optional(), payment_record: ref.optional() }),
});
const unique = (values: BillingReviewReason[]) => [...new Set(values)].sort();

export async function readCanonicalLedger(client: Stripe, input: LedgerReadInput, read: CanonicalRead): Promise<LedgerSnapshot> {
  const pages = (first: unknown, next: (cursor: string) => PromiseLike<unknown>) => canonicalPages(read, first, next);
  const paymentsReader = new CanonicalPayments(client, input.customerId, read);
  const financialTargets = await paymentsReader.targets(input.chargeTargets, input.creditTargets, input.knownChargeLinks);
  const subscriptions = await pages(await read(() => client.subscriptions.list({ customer: input.customerId, status: 'all', limit: 100 })),
    cursor => client.subscriptions.list({ customer: input.customerId, status: 'all', limit: 100, starting_after: cursor }));
  const subscriptionIds = new Set(subscriptions.map(value => subscriptionSchema.parse(value).id));
  for (const id of input.knownSubscriptions) if (!subscriptionIds.has(id)) {
    const value = await read(() => client.subscriptions.retrieve(id));
    consistent(value.id === id); subscriptions.push(value); subscriptionIds.add(id);
  }
  consistent(subscriptions.length <= 500);
  const subscriptionFacts: LedgerSnapshot['subscriptions'] = [];
  const targets = new Set([...input.invoiceTargets, ...financialTargets.invoices]);
  async function subscriptionFact(value: unknown) {
    const sub = subscriptionSchema.parse(value);
    consistent(referenceId(sub.customer) === input.customerId);
    const reasons: BillingReviewReason[] = [];
    const attempt = input.attempts.find(attempt => attempt.id === sub.metadata.studio_checkout_ref);
    if (!attempt || sub.metadata.studio_customer_ref !== input.customerRef ||
      attempt.subscriptionId && attempt.subscriptionId !== sub.id) reasons.push('unexpected-subscription');
    else if (attempt.state !== 'complete' || attempt.subscriptionId !== sub.id) reasons.push('checkout-not-reconciled');
    const items = (await pages(sub.items, cursor => client.subscriptionItems.list({ subscription: sub.id, limit: 100, starting_after: cursor }))).map(value => {
      const item = itemSchema.parse(value);
      consistent(item.subscription === sub.id && item.current_period_end >= item.current_period_start);
      return { id: item.id, priceId: item.price.id, quantity: item.quantity ?? null, periodStart: item.current_period_start, periodEnd: item.current_period_end };
    });
    if (!attempt || items.length !== 1 || items[0].priceId !== attempt.priceId || items[0].quantity !== 1) reasons.push('unexpected-price');
    if (sub.status === 'trialing') reasons.push('trial-not-supported');
    return subscriptionFactSchema.parse({
      id: sub.id, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end, latestInvoiceId: referenceId(sub.latest_invoice),
      billingCycleAnchor: sub.billing_cycle_anchor ?? null,
      anchorConfigured: sub.billing_cycle_anchor_config === undefined ? null : sub.billing_cycle_anchor_config !== null,
      attemptId: attempt?.id ?? null, items: items.sort((a, b) => a.id.localeCompare(b.id)), reviewReasons: unique(reasons),
    });
  }
  for (const value of subscriptions) {
    const fact = await subscriptionFact(value);
    if (fact.latestInvoiceId) targets.add(fact.latestInvoiceId);
    subscriptionFacts.push(fact);
  }
  const invoices = await pages(await read(() => client.invoices.list({ customer: input.customerId, created: { gte: input.since }, limit: 100, expand: ['data.payments'] })),
    cursor => client.invoices.list({ customer: input.customerId, created: { gte: input.since }, limit: 100, starting_after: cursor, expand: ['data.payments'] }));
  const invoiceIds = new Set(invoices.map(value => invoiceSchema.parse(value).id));
  for (const id of targets) if (!invoiceIds.has(id)) {
    const value = await read(() => client.invoices.retrieve(id, { expand: ['payments'] }));
    consistent(value.id === id); invoices.push(value); invoiceIds.add(id);
  }
  consistent(invoices.length <= 500);
  const invoiceFacts: LedgerSnapshot['invoices'] = [];
  for (const value of invoices) {
    const invoice = invoiceSchema.parse(value);
    consistent(referenceId(invoice.customer) === input.customerId);
    const subscriptionId = invoice.parent?.type === 'subscription_details' ? referenceId(invoice.parent.subscription_details?.subscription) : null;
    consistent(invoice.parent?.type !== 'subscription_details' || !!subscriptionId);
    const sub = subscriptionFacts.find(sub => sub.id === subscriptionId);
    const attempt = input.attempts.find(attempt => attempt.id === sub?.attemptId);
    const reasons: BillingReviewReason[] = [];
    if (!sub || !attempt || sub.reviewReasons.includes('unexpected-subscription')) reasons.push('uncorrelated-invoice');
    function invoiceLine(value: unknown) {
      const line = lineSchema.parse(value), directSub = referenceId(line.subscription);
      const parentSub = line.parent?.type === 'subscription_item_details' ? line.parent.subscription_item_details : null;
      consistent(line.invoice === invoice.id && line.currency === invoice.currency && line.period.end >= line.period.start &&
        (!parentSub || !directSub || parentSub.subscription === directSub));
      const priceId = referenceId(line.pricing?.price_details?.price);
      const proration = parentSub?.proration ?? line.parent?.invoice_item_details?.proration ?? null;
      if (!attempt || priceId !== attempt.priceId || !parentSub || parentSub.subscription !== subscriptionId ||
        line.quantity_decimal !== '1' || proration !== false || line.amount <= 0) reasons.push('invoice-adjustment');
      return { id: line.id, priceId, subscriptionId: parentSub?.subscription ?? directSub, itemId: parentSub?.subscription_item ?? null,
        amount: line.amount, currency: line.currency,
        quantity: line.quantity, quantityDecimal: line.quantity_decimal, periodStart: line.period.start, periodEnd: line.period.end, proration };
    }
    const lines = (await pages(invoice.lines, cursor => client.invoices.listLineItems(invoice.id, { limit: 100, starting_after: cursor }))).map(invoiceLine);
    if (lines.length === 0) reasons.push('invoice-adjustment');
    const firstPayments = invoice.payments ?? await read(() => client.invoicePayments.list({ invoice: invoice.id, limit: 100 }));
    const payments = (await pages(firstPayments, cursor => client.invoicePayments.list({ invoice: invoice.id, limit: 100, starting_after: cursor }))).map(value => {
      const payment = paymentSchema.parse(value), reference = referenceId(payment.payment[payment.payment.type]);
      consistent(referenceId(payment.invoice) === invoice.id && payment.currency === invoice.currency && !!reference &&
        (payment.status !== 'paid' || payment.amount_paid !== null));
      return { id: payment.id, status: payment.status, type: payment.payment.type, reference,
        amountPaid: payment.amount_paid, currency: payment.currency };
    });
    const fact = invoiceFactSchema.parse({ id: invoice.id, subscriptionId, status: invoice.status, currency: invoice.currency, created: invoice.created,
      total: invoice.total, amountPaid: invoice.amount_paid, amountRemaining: invoice.amount_remaining, paidAt: invoice.status_transitions.paid_at,
      billingReason: invoice.billing_reason ?? null, collectionMethod: invoice.collection_method ?? null,
      lines, payments, reviewReasons: unique(reasons) });
    const funding = await paymentsReader.invoice(fact);
    const current = invoiceSchema.parse(await read(() => client.invoices.retrieve(invoice.id)));
    consistent(current.id === invoice.id && referenceId(current.customer) === input.customerId && current.status === invoice.status &&
      current.currency === invoice.currency && current.total === invoice.total && current.amount_paid === invoice.amount_paid &&
      current.amount_remaining === invoice.amount_remaining && current.status_transitions.paid_at === invoice.status_transitions.paid_at &&
      current.billing_reason === invoice.billing_reason && current.collection_method === invoice.collection_method &&
      referenceId(current.parent?.subscription_details?.subscription) === subscriptionId && current.created === invoice.created);
    const finalPayments = await pages(current.payments ?? await read(() => client.invoicePayments.list({ invoice: invoice.id, limit: 100 })),
      cursor => client.invoicePayments.list({ invoice: invoice.id, limit: 100, starting_after: cursor }));
    const normalizedFinal = finalPayments.map(value => {
      const payment = paymentSchema.parse(value), reference = referenceId(payment.payment[payment.payment.type]);
      consistent(referenceId(payment.invoice) === invoice.id && payment.currency === invoice.currency && !!reference);
      return { id: payment.id, status: payment.status, type: payment.payment.type, reference, amountPaid: payment.amount_paid, currency: payment.currency };
    });
    consistent(encodePayload({ payments: normalizedFinal.sort((a, b) => a.id.localeCompare(b.id)) }) ===
      encodePayload({ payments: [...payments].sort((a, b) => a.id.localeCompare(b.id)) }));
    if (input.serviceProof) {
      const finalLines = (await pages(current.lines, cursor => client.invoices.listLineItems(invoice.id, { limit: 100, starting_after: cursor }))).map(invoiceLine);
      consistent(encodePayload({ lines: finalLines.sort((a, b) => a.id.localeCompare(b.id)) }) ===
        encodePayload({ lines: [...lines].sort((a, b) => a.id.localeCompare(b.id)) }));
    }
    fact.funding = funding;
    fact.reviewReasons = unique([...reasons, ...funding.reviewReasons, 'commercial-policy-pending']);
    invoiceFacts.push(fact);
  }
  for (const sub of subscriptionFacts) if (sub.latestInvoiceId) {
    consistent(invoiceFacts.some(invoice => invoice.id === sub.latestInvoiceId && invoice.subscriptionId === sub.id));
  }
  for (const sub of input.serviceProof ? subscriptionFacts : []) {
    const current = await subscriptionFact(await read(() => client.subscriptions.retrieve(sub.id)));
    consistent(encodePayload(current) === encodePayload(sub));
  }
  const reasons = [...subscriptionFacts.flatMap(sub => sub.reviewReasons), ...invoiceFacts.flatMap(invoice => invoice.reviewReasons)];
  if (subscriptionFacts.filter(sub => !['canceled', 'incomplete_expired'].includes(sub.status)).length > 1) reasons.push('duplicate-subscriptions');
  if (financialTargets.unresolved.length) reasons.push('payment-lifecycle-unverified');
  return ledgerSnapshotSchema.parse({ scope: 'recent-90-days-and-financial-targets-v2', since: input.since,
    subscriptions: subscriptionFacts.sort((a, b) => a.id.localeCompare(b.id)), invoices: invoiceFacts.sort((a, b) => a.id.localeCompare(b.id)),
    reviewReasons: unique(reasons) });
}
