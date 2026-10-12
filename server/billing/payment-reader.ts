import type Stripe from 'stripe';
import { z } from 'zod';
import type { BillingReviewReason } from '../../shared/billing-ledger';
import { canonicalPages, consistent, type CanonicalRead } from './canonical-pages';
import { providerId, referenceId } from './schema';
import { money, type InvoiceFact } from './ledger-schema';
import { cardSettlementEstablished, chargeFactSchema, creditFactSchema, fundingEvidenceSchema, intentFactSchema, type FundingEvidence } from './payment-schema';
import { encodePayload } from '../jobs/schema';

const ref = z.union([providerId, z.looseObject({ id: providerId })]), currency = z.string().regex(/^[a-z]{3}$/);
const chargeSchema = z.looseObject({
  id: providerId, object: z.literal('charge'), customer: ref.nullable(), livemode: z.literal(false), currency,
  payment_intent: ref.nullable(), amount: money.nonnegative(), amount_captured: money.nonnegative(), amount_refunded: money.nonnegative(),
  status: chargeFactSchema.shape.status, paid: z.boolean(), captured: z.boolean(), refunded: z.boolean(), disputed: z.boolean(),
  payment_method_details: z.looseObject({ type: z.string().regex(/^[a-z_]{1,50}$/) }).nullable(),
  destination: ref.nullable().optional(), on_behalf_of: ref.nullable().optional(), transfer_data: z.unknown().optional(),
});
const intentSchema = z.looseObject({
  id: providerId, object: z.literal('payment_intent'), customer: ref.nullable(), livemode: z.literal(false), currency,
  status: intentFactSchema.shape.status, amount: money.nonnegative(), amount_received: money.nonnegative(), amount_capturable: money.nonnegative(),
  latest_charge: ref.nullable(),
});
const allocationSchema = z.looseObject({
  id: providerId, object: z.literal('invoice_payment'), invoice: ref, livemode: z.literal(false), currency,
  status: z.enum(['open', 'paid', 'canceled']), amount_paid: money.nonnegative().nullable(),
  payment: z.looseObject({ type: z.literal('payment_intent'), payment_intent: ref }),
});
const refundSchema = z.looseObject({
  id: providerId, object: z.literal('refund'), charge: ref.nullable(), payment_intent: ref.nullable(),
  customer: ref.nullable(), currency, amount: money.nonnegative(), status: chargeFactSchema.shape.refunds.element.shape.status,
});
const disputeSchema = z.looseObject({
  id: providerId, object: z.literal('dispute'), charge: ref, payment_intent: ref.nullable(), livemode: z.literal(false),
  currency, amount: money.nonnegative(), status: chargeFactSchema.shape.disputes.element.shape.status,
});
const creditSchema = z.looseObject({
  id: providerId, object: z.literal('credit_note'), customer: ref, invoice: ref, livemode: z.literal(false),
  currency, amount: money.nonnegative(), status: creditFactSchema.shape.status,
});
const sum = (values: number[]) => money.nonnegative().parse(values.reduce((total, value) => total + value, 0));
export class CanonicalPayments {
  private readonly intents = new Map<string, Promise<z.infer<typeof intentFactSchema>>>();
  private readonly charges = new Map<string, Promise<z.infer<typeof chargeFactSchema>>>();
  private readonly allocations = new Map<string, Promise<z.infer<typeof allocationSchema>[]>>();
  private readonly intentCharges = new Map<string, Promise<string[]>>();
  constructor(private readonly client: Stripe, private readonly customerId: string, private readonly read: CanonicalRead) {}
  private async chargeHeader(id: string) {
    const value = chargeSchema.parse(await this.read(() => this.client.charges.retrieve(id)));
    consistent(value.id === id && referenceId(value.customer) === this.customerId);
    return value;
  }
  private async intentAllocations(id: string, refresh = false) {
    if (refresh) this.allocations.delete(id);
    let pending = this.allocations.get(id);
    if (!pending) {
      pending = (async () => {
        const params = { payment: { type: 'payment_intent' as const, payment_intent: id }, limit: 100 };
        return (await canonicalPages(this.read, await this.read(() => this.client.invoicePayments.list(params)),
          cursor => this.client.invoicePayments.list({ ...params, starting_after: cursor }))).map(value => {
          const allocation = allocationSchema.parse(value);
          consistent(referenceId(allocation.payment.payment_intent) === id && (allocation.status !== 'paid' || allocation.amount_paid !== null));
          return allocation;
        });
      })();
      this.allocations.set(id, pending);
    }
    return pending;
  }
  async targets(chargeIds: string[], creditIds: string[], known: { chargeId: string; invoiceId: string }[]) {
    const invoices = new Set<string>(), unresolved = new Set<string>();
    for (const id of chargeIds) {
      const charge = await this.chargeHeader(id), intentId = referenceId(charge.payment_intent);
      const local = known.filter(link => link.chargeId === id).map(link => link.invoiceId);
      for (const invoiceId of local) invoices.add(invoiceId);
      const allocations = intentId ? await this.intentAllocations(intentId) : [];
      for (const allocation of allocations) {
        consistent(allocation.currency === charge.currency); invoices.add(referenceId(allocation.invoice)!);
      }
      if (!local.length && !allocations.length) unresolved.add(id);
    }
    for (const id of creditIds) {
      const credit = creditSchema.parse(await this.read(() => this.client.creditNotes.retrieve(id)));
      consistent(credit.id === id && referenceId(credit.customer) === this.customerId);
      invoices.add(referenceId(credit.invoice)!);
    }
    return { invoices: [...invoices], unresolved: [...unresolved] };
  }
  private async charge(id: string) {
    let pending = this.charges.get(id);
    if (!pending) {
      pending = (async () => {
        const charge = await this.chargeHeader(id), intentId = referenceId(charge.payment_intent);
        consistent(!charge.destination && !charge.on_behalf_of && !charge.transfer_data);
        const refunds = (await canonicalPages(this.read, await this.read(() => this.client.refunds.list({ charge: id, limit: 100 })),
          cursor => this.client.refunds.list({ charge: id, limit: 100, starting_after: cursor }))).map(value => {
          const refund = refundSchema.parse(value);
          consistent(referenceId(refund.charge) === id && referenceId(refund.payment_intent) === intentId &&
            (!refund.customer || referenceId(refund.customer) === this.customerId) && refund.currency === charge.currency);
          return { id: refund.id, amount: refund.amount, status: refund.status };
        });
        const disputes = (await canonicalPages(this.read, await this.read(() => this.client.disputes.list({ charge: id, limit: 100 })),
          cursor => this.client.disputes.list({ charge: id, limit: 100, starting_after: cursor }))).map(value => {
          const dispute = disputeSchema.parse(value);
          consistent(referenceId(dispute.charge) === id && referenceId(dispute.payment_intent) === intentId && dispute.currency === charge.currency);
          return { id: dispute.id, amount: dispute.amount, status: dispute.status };
        });
        const current = await this.chargeHeader(id);
        consistent(current.currency === charge.currency && referenceId(current.payment_intent) === intentId &&
          current.amount === charge.amount && current.amount_captured === charge.amount_captured &&
          current.amount_refunded === charge.amount_refunded && current.disputed === charge.disputed &&
          current.paid === charge.paid && current.captured === charge.captured && current.status === charge.status &&
          current.refunded === charge.refunded &&
          current.payment_method_details?.type === charge.payment_method_details?.type &&
          !current.destination && !current.on_behalf_of && !current.transfer_data &&
          sum(refunds.filter(refund => refund.status === 'succeeded').map(refund => refund.amount)) <= charge.amount_refunded &&
          sum(refunds.filter(refund => ['succeeded', 'pending', 'requires_action'].includes(refund.status)).map(refund => refund.amount)) >= charge.amount_refunded &&
          charge.amount_refunded <= charge.amount_captured && charge.amount_captured <= charge.amount &&
          (!charge.disputed || disputes.length > 0) && (!charge.refunded || charge.amount_refunded === charge.amount));
        return chargeFactSchema.parse({ id, currency: charge.currency, intentId, amount: charge.amount, capturedAmount: charge.amount_captured, refundedAmount: charge.amount_refunded,
          status: charge.status, paid: charge.paid, captured: charge.captured, method: charge.payment_method_details?.type ?? null,
          refunds: refunds.sort((a, b) => a.id.localeCompare(b.id)), disputes: disputes.sort((a, b) => a.id.localeCompare(b.id)) });
      })();
      this.charges.set(id, pending);
    }
    return pending;
  }
  private async intent(id: string, expectedCurrency: string) {
    let pending = this.intents.get(id);
    if (!pending) {
      pending = (async () => {
        const intent = intentSchema.parse(await this.read(() => this.client.paymentIntents.retrieve(id)));
        consistent(intent.id === id && referenceId(intent.customer) === this.customerId && intent.currency === expectedCurrency);
        const allocations = (await this.intentAllocations(id)).map(allocation => {
          consistent(allocation.currency === intent.currency);
          return { id: allocation.id, invoiceId: referenceId(allocation.invoice), status: allocation.status, amountPaid: allocation.amount_paid };
        });
        return intentFactSchema.parse({ id, currency: intent.currency, status: intent.status, amount: intent.amount, received: intent.amount_received,
          capturable: intent.amount_capturable, latestCharge: referenceId(intent.latest_charge), allocations });
      })();
      this.intents.set(id, pending);
    }
    const value = await pending; consistent(value.currency === expectedCurrency);
    return value;
  }
  private async chargesForIntent(id: string, expectedCurrency: string) {
    let pending = this.intentCharges.get(id);
    if (!pending) {
      pending = (async () => {
        const all = await canonicalPages(this.read, await this.read(() => this.client.charges.list({ payment_intent: id, limit: 100 })),
          cursor => this.client.charges.list({ payment_intent: id, limit: 100, starting_after: cursor }));
        return all.map(value => {
          const header = chargeSchema.parse(value);
          consistent(referenceId(header.payment_intent) === id && header.currency === expectedCurrency && referenceId(header.customer) === this.customerId);
          return header.id;
        });
      })();
      this.intentCharges.set(id, pending);
    }
    return pending;
  }
  async invoice(invoice: InvoiceFact): Promise<FundingEvidence> {
    const reasons: BillingReviewReason[] = [], intents: FundingEvidence['intents'] = [], charges = new Map<string, FundingEvidence['charges'][number]>();
    for (const payment of invoice.payments) {
      if (payment.type === 'payment_record') { reasons.push('unsupported-payment-funding'); continue; }
      if (payment.type === 'charge') {
        const charge = await this.charge(payment.reference);
        consistent(charge.intentId === null && charge.currency === invoice.currency); charges.set(charge.id, charge); reasons.push('unsupported-payment-funding'); continue;
      }
      const intent = await this.intent(payment.reference, invoice.currency);
      const allocation = intent.allocations.find(allocation => allocation.id === payment.id);
      consistent(!!allocation && allocation.invoiceId === invoice.id && allocation.status === payment.status && allocation.amountPaid === payment.amountPaid);
      if (!intents.some(value => value.id === intent.id)) intents.push(intent);
      for (const id of await this.chargesForIntent(intent.id, invoice.currency)) {
        if (!charges.has(id)) {
          const charge = await this.charge(id); consistent(charge.currency === invoice.currency && charge.intentId === intent.id);
          charges.set(id, charge);
        }
      }
      if (intent.latestCharge) consistent(charges.has(intent.latestCharge));
    }
    const credits = (await canonicalPages(this.read, await this.read(() => this.client.creditNotes.list({ invoice: invoice.id, limit: 100 })),
      cursor => this.client.creditNotes.list({ invoice: invoice.id, limit: 100, starting_after: cursor }))).map(value => {
      const credit = creditSchema.parse(value);
      consistent(referenceId(credit.invoice) === invoice.id && referenceId(credit.customer) === this.customerId && credit.currency === invoice.currency);
      return { id: credit.id, amount: credit.amount, status: credit.status };
    });
    for (const intent of intents) {
      const current = intentSchema.parse(await this.read(() => this.client.paymentIntents.retrieve(intent.id)));
      consistent(current.id === intent.id && referenceId(current.customer) === this.customerId && current.currency === invoice.currency &&
        current.status === intent.status && current.amount === intent.amount && current.amount_received === intent.received &&
        current.amount_capturable === intent.capturable && referenceId(current.latest_charge) === intent.latestCharge);
      const allocations = (await this.intentAllocations(intent.id, true)).map(value => {
        consistent(value.currency === invoice.currency);
        return { id: value.id, invoiceId: referenceId(value.invoice), status: value.status, amountPaid: value.amount_paid };
      });
      consistent(encodePayload({ allocations: allocations.sort((a, b) => a.id.localeCompare(b.id)) }) ===
        encodePayload({ allocations: [...intent.allocations].sort((a, b) => a.id.localeCompare(b.id)) }));
    }
    const captured = sum([...charges.values()].map(charge => charge.capturedAmount)),
      refunded = sum([...charges.values()].flatMap(charge => charge.refunds.filter(refund => refund.status === 'succeeded').map(refund => refund.amount)));
    const established = cardSettlementEstablished(invoice, intents, [...charges.values()]);
    let state: FundingEvidence['state'] = established ? 'settled' : invoice.amountPaid === 0 && captured === 0 ? 'unpaid' : 'review-required';
    if (!established) reasons.push('payment-not-settled');
    if (credits.some(credit => credit.status === 'issued')) { reasons.push('credit-adjustment'); state = 'review-required'; }
    if ([...charges.values()].some(charge => charge.refunds.some(refund => ['pending', 'requires_action'].includes(refund.status)))) {
      reasons.push('refund-pending'); state = 'review-required';
    }
    if (refunded > 0) { reasons.push('payment-refunded'); state = refunded === captured ? 'refunded' : 'partially-refunded'; }
    if ([...charges.values()].some(charge => charge.disputes.length)) { reasons.push('payment-disputed'); state = 'disputed'; }
    if (reasons.includes('unsupported-payment-funding') && state === 'settled') state = 'review-required';
    return fundingEvidenceSchema.parse({ version: 'sandbox-card-evidence-v1', state, captured, refunded, currency: invoice.currency,
      intents: intents.sort((a, b) => a.id.localeCompare(b.id)), charges: [...charges.values()].sort((a, b) => a.id.localeCompare(b.id)),
      credits: credits.sort((a, b) => a.id.localeCompare(b.id)), reviewReasons: [...new Set(reasons)].sort() });
  }
}
