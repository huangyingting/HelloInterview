import Stripe from 'stripe';
import { z } from 'zod';
import type { BillingReviewReason } from '../../shared/billing-ledger';
import { TerminalJobFailure } from '../jobs';
import { providerId, referenceId } from './schema';
import { invoiceFactSchema, ledgerSnapshotSchema, money, seconds, subscriptionFactSchema, type LedgerSnapshot } from './ledger-schema';

export interface LedgerReadInput {
  customerRef: string; customerId: string; since: number;
  attempts: { id: string; priceId: string; subscriptionId: string | null; state: string }[];
  knownSubscriptions: string[]; invoiceTargets: string[]; paymentEvents: boolean;
}
export type CanonicalRead = <T>(request: () => PromiseLike<T>) => Promise<T>;
const pageSchema = z.looseObject({ object: z.literal('list'), has_more: z.boolean(), data: z.array(z.unknown()).max(100) });
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
  metadata: z.record(z.string(), z.string()), items: pageSchema,
});
const invoiceSchema = z.looseObject({
  id: providerId, object: z.literal('invoice'), customer: ref, livemode: z.literal(false), created: seconds,
  status: invoiceFactSchema.shape.status, currency, total: money, amount_paid: money.nonnegative(), amount_remaining: money.nonnegative(),
  status_transitions: z.looseObject({ paid_at: seconds.nullable() }),
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
function consistent(value: boolean) { if (!value) throw new TerminalJobFailure('reconciliation-required'); }
const unique = (values: BillingReviewReason[]) => [...new Set(values)].sort();

export async function readCanonicalLedger(client: Stripe, input: LedgerReadInput, read: CanonicalRead): Promise<LedgerSnapshot> {
  async function pages(first: unknown, next: (cursor: string) => PromiseLike<unknown>) {
    const results: unknown[] = [], ids = new Set<string>();
    let value = first;
    for (let count = 0; count < 5; count++) {
      const page = pageSchema.parse(value);
      consistent(!page.has_more || page.data.length > 0);
      for (const row of page.data) {
        const id = z.looseObject({ id: providerId }).parse(row).id;
        consistent(!ids.has(id)); ids.add(id); results.push(row);
      }
      if (!page.has_more) return results;
      consistent(count < 4);
      value = await read(() => next(z.looseObject({ id: providerId }).parse(page.data.at(-1)).id));
    }
    throw new TerminalJobFailure('reconciliation-required');
  }
  const subscriptions = await pages(await read(() => client.subscriptions.list({ customer: input.customerId, status: 'all', limit: 100 })),
    cursor => client.subscriptions.list({ customer: input.customerId, status: 'all', limit: 100, starting_after: cursor }));
  const subscriptionIds = new Set(subscriptions.map(value => subscriptionSchema.parse(value).id));
  for (const id of input.knownSubscriptions) if (!subscriptionIds.has(id)) {
    const value = await read(() => client.subscriptions.retrieve(id));
    consistent(value.id === id); subscriptions.push(value); subscriptionIds.add(id);
  }
  consistent(subscriptions.length <= 500);
  const subscriptionFacts: LedgerSnapshot['subscriptions'] = [];
  const targets = new Set(input.invoiceTargets);
  for (const value of subscriptions) {
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
    const latestInvoiceId = referenceId(sub.latest_invoice);
    if (latestInvoiceId) targets.add(latestInvoiceId);
    subscriptionFacts.push(subscriptionFactSchema.parse({
      id: sub.id, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end, latestInvoiceId,
      attemptId: attempt?.id ?? null, items, reviewReasons: unique(reasons),
    }));
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
    const lines = (await pages(invoice.lines, cursor => client.invoices.listLineItems(invoice.id, { limit: 100, starting_after: cursor }))).map(value => {
      const line = lineSchema.parse(value), directSub = referenceId(line.subscription);
      const parentSub = line.parent?.type === 'subscription_item_details' ? line.parent.subscription_item_details : null;
      consistent(line.invoice === invoice.id && line.currency === invoice.currency && line.period.end >= line.period.start &&
        (!parentSub || !directSub || parentSub.subscription === directSub));
      const priceId = referenceId(line.pricing?.price_details?.price);
      const proration = parentSub?.proration ?? line.parent?.invoice_item_details?.proration ?? null;
      if (!attempt || priceId !== attempt.priceId || !parentSub || parentSub.subscription !== subscriptionId ||
        line.quantity_decimal !== '1' || proration !== false || line.amount <= 0) reasons.push('invoice-adjustment');
      return { id: line.id, priceId, subscriptionId: parentSub?.subscription ?? directSub, amount: line.amount, currency: line.currency,
        quantity: line.quantity, quantityDecimal: line.quantity_decimal, periodStart: line.period.start, periodEnd: line.period.end, proration };
    });
    if (lines.length === 0) reasons.push('invoice-adjustment');
    const firstPayments = invoice.payments ?? await read(() => client.invoicePayments.list({ invoice: invoice.id, limit: 100 }));
    const payments = (await pages(firstPayments, cursor => client.invoicePayments.list({ invoice: invoice.id, limit: 100, starting_after: cursor }))).map(value => {
      const payment = paymentSchema.parse(value), reference = referenceId(payment.payment[payment.payment.type]);
      consistent(referenceId(payment.invoice) === invoice.id && payment.currency === invoice.currency && !!reference &&
        (payment.status !== 'paid' || payment.amount_paid !== null));
      return { id: payment.id, status: payment.status, type: payment.payment.type, reference,
        amountPaid: payment.amount_paid, currency: payment.currency };
    });
    if (invoice.status === 'paid' || invoice.amount_paid > 0 || payments.some(payment => payment.status === 'paid')) reasons.push('payment-attestation-pending');
    invoiceFacts.push(invoiceFactSchema.parse({ id: invoice.id, subscriptionId, status: invoice.status, currency: invoice.currency, created: invoice.created,
      total: invoice.total, amountPaid: invoice.amount_paid, amountRemaining: invoice.amount_remaining, paidAt: invoice.status_transitions.paid_at,
      lines, payments, reviewReasons: unique(reasons) }));
  }
  for (const sub of subscriptionFacts) if (sub.latestInvoiceId) {
    consistent(invoiceFacts.some(invoice => invoice.id === sub.latestInvoiceId && invoice.subscriptionId === sub.id));
  }
  const reasons = [...subscriptionFacts.flatMap(sub => sub.reviewReasons), ...invoiceFacts.flatMap(invoice => invoice.reviewReasons)];
  if (subscriptionFacts.filter(sub => !['canceled', 'incomplete_expired'].includes(sub.status)).length > 1) reasons.push('duplicate-subscriptions');
  if (input.paymentEvents) reasons.push('payment-lifecycle-unverified');
  return ledgerSnapshotSchema.parse({ scope: 'recent-90-days-and-known-targets-v1', since: input.since,
    subscriptions: subscriptionFacts.sort((a, b) => a.id.localeCompare(b.id)), invoices: invoiceFacts.sort((a, b) => a.id.localeCompare(b.id)),
    reviewReasons: unique(reasons) });
}
