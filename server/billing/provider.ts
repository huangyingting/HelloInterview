import Stripe from 'stripe';
import type { BillingConfig } from './config';
import { digest, encodePayload } from '../jobs/schema';
import { canonicalObjectSchema, notification, observationSchema, providerId, referenceId, stripeApiVersion, type Notification, type Observation } from './schema';
import { z } from 'zod';
import { TerminalJobFailure } from '../jobs';
import { checkoutSchema, customerSchema, hostedCheckoutUrl, priceSchema, type CheckoutRow } from './checkout-schema';
import { readCanonicalLedger, type CanonicalRead, type LedgerReadInput } from './ledger-reader';
import { cardOnlyConfiguration, hostedPortalUrl, portalAuthority, portalConfigurationSchema, portalSessionSchema, type PortalScope } from './portal-schema';
import type { ResumptionOperation } from './resumption-schema';
import { seconds } from './ledger-schema';

const listSchema = z.looseObject({ object: z.literal('list'), has_more: z.boolean(), data: z.array(z.unknown()).max(100) });
const subscriptionSchema = z.looseObject({
  id: providerId, object: z.literal('subscription'), customer: providerId, livemode: z.literal(false),
  status: z.enum(['active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid']),
});
const renewalSchema = subscriptionSchema.extend({
  cancel_at_period_end: z.boolean(), cancel_at: z.number().int().nonnegative().nullable(),
  schedule: z.null(), pending_update: z.null(),
  metadata: z.looseObject({ studio_customer_ref: z.uuid(), studio_checkout_ref: z.uuid() }),
  items: z.looseObject({ has_more: z.literal(false), data: z.array(z.looseObject({
    subscription: providerId, quantity: z.literal(1), price: z.looseObject({ id: providerId }),
  })).length(1) }),
});
const resumptionSchema = renewalSchema.extend({
  status: z.literal('active'), application: z.null(), on_behalf_of: z.null(), currency: z.literal('usd'),
  application_fee_percent: z.null(), transfer_data: z.null(),
  billing_cycle_anchor: seconds, billing_cycle_anchor_config: z.null(),
  latest_invoice: z.union([providerId, z.looseObject({ id: providerId })]).nullable(),
  collection_method: z.literal('charge_automatically'), pause_collection: z.null(), trial_end: z.null(),
  automatic_tax: z.looseObject({ enabled: z.literal(false) }), discounts: z.array(z.never()).length(0),
  default_tax_rates: z.array(z.never()).length(0), billing_thresholds: z.null(), pending_invoice_item_interval: z.null(),
  items: z.looseObject({ has_more: z.literal(false), data: z.array(z.looseObject({
    id: providerId, subscription: providerId, quantity: z.literal(1), price: z.looseObject({ id: providerId }),
    current_period_start: seconds, current_period_end: seconds,
    discounts: z.array(z.never()).length(0), tax_rates: z.array(z.never()).length(0), billing_thresholds: z.null(),
  })).length(1) }),
});
export class StripeEvidence {
  private readonly client: Stripe;
  constructor(private readonly settings: BillingConfig, private readonly shutdown: AbortSignal, client?: Stripe) {
    if (Stripe.API_VERSION !== stripeApiVersion) throw new Error('The Stripe SDK and reference API versions do not match.');
    this.client = client ?? new Stripe(settings.secretKey, { apiVersion: stripeApiVersion, timeout: 3000, maxNetworkRetries: 0 });
  }
  verify(body: Buffer, signature: string) {
    return this.client.webhooks.constructEvent(body, signature, this.settings.webhookSecret, 300);
  }
  private assertRunning(signal?: AbortSignal) { this.shutdown.throwIfAborted(); signal?.throwIfAborted(); }
  private async account(signal?: AbortSignal) {
    this.assertRunning(signal);
    const account = await this.client.accounts.retrieve(null);
    this.assertRunning(signal);
    if (account.id !== this.settings.accountId || account.object !== 'account') throw new Error('The canonical provider account does not match the configured reference.');
  }
  async observe(input: Notification, signal?: AbortSignal): Promise<Observation> {
    await this.account(signal);
    const event = notification(await this.client.events.retrieve(input.eventId), this.settings.accountId);
    this.assertRunning(signal);
    if (encodePayload(event) !== encodePayload(input) || event.classification !== 'supported') throw new Error('Canonical event evidence conflicts with the accepted notification.');
    let value: unknown;
    switch (event.objectKind) {
      case 'checkout.session': value = await this.client.checkout.sessions.retrieve(event.objectId); break;
      case 'subscription': value = await this.client.subscriptions.retrieve(event.objectId); break;
      case 'invoice': value = await this.client.invoices.retrieve(event.objectId); break;
      case 'charge': value = await this.client.charges.retrieve(event.objectId); break;
      case 'refund': value = await this.client.refunds.retrieve(event.objectId); break;
      case 'dispute': value = await this.client.disputes.retrieve(event.objectId); break;
      case 'credit_note': value = await this.client.creditNotes.retrieve(event.objectId); break;
      default: throw new Error('The billing object family is unsupported.');
    }
    this.assertRunning(signal);
    const object = canonicalObjectSchema.parse(value);
    if (object.id !== event.objectId || object.object !== event.objectKind ||
      object.object !== 'refund' && object.livemode !== false) throw new Error('The canonical billing object does not match this sandbox notification.');
    let customerId = referenceId(object.customer);
    const chargeId = referenceId(object.charge);
    if ((object.object === 'refund' || object.object === 'dispute') && chargeId) {
      const charge = canonicalObjectSchema.parse(await this.client.charges.retrieve(chargeId));
      this.assertRunning(signal);
      if (charge.id !== chargeId || charge.object !== 'charge' || charge.livemode !== false) throw new Error('The canonical payment reference is inconsistent.');
      const chargeCustomer = referenceId(charge.customer);
      if (customerId && chargeCustomer !== customerId) throw new Error('The canonical billing customer references conflict.');
      customerId = chargeCustomer;
    }
    return observationSchema.parse({
      accountId: input.accountId, eventId: input.eventId, objectId: object.id, objectKind: object.object,
      customerId, subscriptionId: object.object === 'subscription' ? object.id :
        referenceId(object.subscription) ?? referenceId(object.parent?.subscription_details?.subscription),
      chargeId, status: object.status ?? null, currency: object.currency ?? null,
      amount: object.amount_paid ?? object.amount_total ?? object.amount ?? null,
      amountRefunded: object.amount_refunded ?? null, paid: object.object === 'invoice' ? object.status === 'paid' : object.paid ?? null,
    });
  }
  private customer(value: unknown, reference: string, expectedId?: string) {
    const customer = customerSchema.parse(value);
    if (!customer.id.startsWith('cus_') || customer.metadata.studio_customer_ref !== reference || expectedId && customer.id !== expectedId) {
      throw new Error('The canonical customer does not match its server-created ownership correlation.');
    }
    return customer;
  }
  async ledger(input: LedgerReadInput, checkpoint: () => Promise<void>, signal?: AbortSignal) {
    let requests = 0;
    const read: CanonicalRead = async request => {
      if (++requests > 48) throw new TerminalJobFailure('reconciliation-required');
      this.assertRunning(signal); await checkpoint();
      const value = await request(); this.assertRunning(signal);
      return value;
    };
    await read(() => this.account(signal));
    this.customer(await read(() => this.client.customers.retrieve(input.customerId)), input.customerRef, input.customerId);
    return readCanonicalLedger(this.client, input, read);
  }
  async portalSession(scope: PortalScope, beforeMutation: () => Promise<void>, signal?: AbortSignal) {
    if (!this.settings.portalConfiguration || scope.configurationId !== this.settings.portalConfiguration) {
      throw new Error('Restricted Portal issuance requires the explicit captured operator configuration.');
    }
    let requests = 0;
    const read: CanonicalRead = async action => {
      if (++requests > 8) throw new Error('Restricted Portal preparation exceeded its SDK request bound.');
      this.assertRunning(signal); const value = await action(); this.assertRunning(signal); return value;
    };
    await read(() => this.account(signal));
    this.customer(await read(() => this.client.customers.retrieve(scope.customerId)), scope.customerRef, scope.customerId);
    const configuration = portalConfigurationSchema.parse(await read(() => this.client.billingPortal.configurations.retrieve(scope.configurationId)));
    if (configuration.id !== scope.configurationId) throw new Error('The Portal configuration differs from the captured operator selection.');
    const methodId = configuration.features.payment_method_update.payment_method_configuration;
    const methods = cardOnlyConfiguration(await read(() => this.client.paymentMethodConfigurations.retrieve(methodId)), methodId);
    await beforeMutation(); this.assertRunning(signal);
    const session = portalSessionSchema.parse(await read(() => this.client.billingPortal.sessions.create({
      customer: scope.customerId, configuration: scope.configurationId, return_url: `${scope.origin}/billing?portal=returned`,
    }, { idempotencyKey: scope.id })));
    if (session.customer !== scope.customerId || referenceId(session.configuration) !== scope.configurationId ||
      session.return_url !== `${scope.origin}/billing?portal=returned`) throw new Error('The hosted Portal session differs from its owned preparation.');
    const url = hostedPortalUrl(session.url);
    const current = portalConfigurationSchema.parse(await read(() => this.client.billingPortal.configurations.retrieve(scope.configurationId)));
    if (current.id !== configuration.id || encodePayload(current.features) !== encodePayload(configuration.features)) throw new Error('Portal policy moved during preparation.');
    const finalMethods = cardOnlyConfiguration(await read(() => this.client.paymentMethodConfigurations.retrieve(methodId)), methodId);
    if (methods !== finalMethods) throw new Error('Portal payment-method policy moved during preparation.');
    this.customer(await read(() => this.client.customers.retrieve(scope.customerId)), scope.customerRef, scope.customerId);
    return { id: session.id, created: session.created, url, proof: digest(encodePayload({ policy: portalAuthority,
      configurationId: scope.configurationId, methodId, methods, features: configuration.features })) };
  }
  async createCustomer(reference: string, operationId: string, replayWindow: boolean, beforeMutation: () => Promise<void>, signal?: AbortSignal) {
    await this.account(signal);
    let id: string;
    if (replayWindow) {
      await beforeMutation();
      this.assertRunning(signal);
      id = this.customer(await this.client.customers.create({ metadata: { studio_customer_ref: reference } }, { idempotencyKey: operationId }), reference).id;
    } else {
      const candidates = z.looseObject({ object: z.literal('search_result'), has_more: z.boolean(), data: z.array(z.unknown()).max(2) })
        .parse(await this.client.customers.search({ query: `metadata['studio_customer_ref']:'${z.uuid().parse(reference)}'`, limit: 2 }));
      if (candidates.has_more || candidates.data.length !== 1) throw new TerminalJobFailure('reconciliation-required');
      id = this.customer(candidates.data[0], reference).id;
    }
    this.assertRunning(signal);
    const customer = this.customer(await this.client.customers.retrieve(id), reference, id);
    this.assertRunning(signal);
    return customer.id;
  }
  async stopRenewal(attempt: CheckoutRow, customerId: string, operationId: string, replayWindow: boolean,
    beforeMutation: () => Promise<void>, checkpoint: () => Promise<void>, signal?: AbortSignal): Promise<'nonrenewing' | 'ended'> {
    let requests = 0;
    const read: CanonicalRead = async action => {
      if (++requests > 6) throw new TerminalJobFailure('reconciliation-required');
      this.assertRunning(signal); await checkpoint();
      const result = await action(); this.assertRunning(signal); return result;
    };
    await read(() => this.account(signal));
    this.customer(await read(() => this.client.customers.retrieve(customerId)), attempt.customer_ref, customerId);
    const subscriptionId = attempt.subscription_id;
    if (!subscriptionId) throw new TerminalJobFailure('not-eligible');
    const validate = (value: unknown) => {
      const sub = renewalSchema.parse(value), item = sub.items.data[0];
      if (sub.id !== subscriptionId || sub.customer !== customerId || sub.metadata.studio_customer_ref !== attempt.customer_ref ||
        sub.metadata.studio_checkout_ref !== attempt.id || item.subscription !== sub.id || item.price.id !== attempt.price_id) {
        throw new TerminalJobFailure('reconciliation-required');
      }
      return sub;
    };
    const initial = validate(await read(() => this.client.subscriptions.retrieve(subscriptionId)));
    if (!initial.cancel_at_period_end && !['canceled', 'incomplete_expired'].includes(initial.status)) {
      if (!replayWindow || initial.cancel_at !== null || !['active', 'past_due', 'unpaid', 'paused'].includes(initial.status)) throw new TerminalJobFailure('reconciliation-required');
      validate(await read(async () => {
        await beforeMutation(); this.assertRunning(signal);
        return this.client.subscriptions.update(initial.id,
          { cancel_at_period_end: true, proration_behavior: 'none' }, { idempotencyKey: operationId });
      }));
    }
    const current = validate(await read(() => this.client.subscriptions.retrieve(initial.id)));
    if (['canceled', 'incomplete_expired'].includes(current.status)) return 'ended';
    if (!current.cancel_at_period_end) throw new TerminalJobFailure('reconciliation-required');
    return 'nonrenewing';
  }
  async resumeRenewal(attempt: CheckoutRow, input: ResumptionOperation, customerId: string, operationId: string, replayWindow: boolean,
    beforeMutation: () => Promise<void>, checkpoint: () => Promise<void>, signal?: AbortSignal): Promise<'renewing'> {
    let requests = 0;
    const read: CanonicalRead = async action => {
      if (++requests > 8) throw new TerminalJobFailure('reconciliation-required');
      this.assertRunning(signal); await checkpoint();
      const result = await action(); this.assertRunning(signal); return result;
    };
    const validate = (value: unknown) => {
      const sub = resumptionSchema.parse(value), item = sub.items.data[0];
      if (sub.id !== input.subscriptionId || sub.id !== attempt.subscription_id || sub.customer !== customerId ||
        sub.metadata.studio_customer_ref !== attempt.customer_ref || sub.metadata.studio_checkout_ref !== attempt.id ||
        item.id !== input.itemId || item.subscription !== sub.id || item.price.id !== input.priceId ||
        sub.billing_cycle_anchor !== input.billingAnchor ||
        item.current_period_end <= item.current_period_start) throw new TerminalJobFailure('reconciliation-required');
      return sub;
    };
    await read(() => this.account(signal));
    this.customer(await read(() => this.client.customers.retrieve(customerId)), attempt.customer_ref, customerId);
    const initial = validate(await read(() => this.client.subscriptions.retrieve(input.subscriptionId))), item = initial.items.data[0];
    if (initial.cancel_at_period_end) {
      if (!replayWindow || initial.cancel_at !== null && initial.cancel_at !== item.current_period_end ||
        item.current_period_start !== input.periodStart || item.current_period_end !== input.periodEnd ||
        referenceId(initial.latest_invoice) !== input.invoiceId) throw new TerminalJobFailure('reconciliation-required');
      const price = priceSchema.parse(await read(() => this.client.prices.retrieve(input.priceId)));
      if (price.id !== input.priceId || !price.active || price.unit_amount !== input.unitAmount || price.currency !== input.currency ||
        price.recurring.interval !== (input.offer === 'pro_annual' ? 'year' : 'month')) throw new TerminalJobFailure('reconciliation-required');
      const productId = referenceId(price.product);
      if (!productId) throw new TerminalJobFailure('reconciliation-required');
      const product = z.looseObject({ id: providerId, object: z.literal('product'), active: z.literal(true), livemode: z.literal(false) })
        .parse(await read(() => this.client.products.retrieve(productId)));
      if (product.id !== productId) throw new TerminalJobFailure('reconciliation-required');
      validate(await read(async () => {
        await beforeMutation(); this.assertRunning(signal);
        return this.client.subscriptions.update(initial.id,
          { cancel_at_period_end: false, proration_behavior: 'none' }, { idempotencyKey: operationId });
      }));
    }
    const current = validate(await read(() => this.client.subscriptions.retrieve(input.subscriptionId))), currentItem = current.items.data[0];
    if (current.cancel_at_period_end || current.cancel_at !== null || initial.cancel_at_period_end &&
      (currentItem.current_period_start !== input.periodStart || currentItem.current_period_end !== input.periodEnd ||
        referenceId(current.latest_invoice) !== input.invoiceId)) throw new TerminalJobFailure('reconciliation-required');
    this.customer(await read(() => this.client.customers.retrieve(customerId)), attempt.customer_ref, customerId);
    return 'renewing';
  }
  private session(value: unknown, attempt: CheckoutRow, customerId: string, origin: string, checkLineItems = false) {
    const session = checkoutSchema.parse(value);
    if (session.client_reference_id !== attempt.id || session.metadata.studio_customer_ref !== attempt.customer_ref ||
      referenceId(session.customer) !== customerId || session.expires_at * 1000 !== attempt.expires_at ||
      session.success_url !== `${origin}/billing?attempt=${attempt.id}` || session.cancel_url !== `${origin}/billing?attempt=${attempt.id}&cancelled=true` ||
      attempt.session_id && session.id !== attempt.session_id) throw new Error('The canonical checkout does not match its owned immutable intent.');
    if (session.status === 'open' && !session.url) throw new Error('An open hosted checkout is missing its private redirect.');
    if (checkLineItems && (!session.line_items || session.line_items.has_more || session.line_items.data.length !== 1 ||
      session.line_items.data[0].price?.id !== attempt.price_id)) throw new Error('The canonical checkout line item does not match its allowlisted reference offer.');
    return { id: session.id, state: session.status, paymentStatus: session.payment_status,
      subscriptionId: referenceId(session.subscription), url: session.status === 'open' && session.url ? hostedCheckoutUrl(session.url) : null };
  }
  async refreshCheckout(attempt: CheckoutRow, customerId: string, origin: string, signal?: AbortSignal) {
    await this.account(signal);
    this.customer(await this.client.customers.retrieve(customerId), attempt.customer_ref, customerId);
    if (!attempt.session_id) throw new TerminalJobFailure('reconciliation-required');
    const session = await this.client.checkout.sessions.retrieve(attempt.session_id, { expand: ['line_items'] });
    this.assertRunning(signal);
    return this.session(session, attempt, customerId, origin, true);
  }
  async createCheckout(attempt: CheckoutRow, customerId: string, origin: string, operationId: string, replayWindow: boolean,
    beforeMutation: () => Promise<void>, signal?: AbortSignal, parent?: { subscriptionId: string; attemptId: string; priceId: string }) {
    await this.account(signal);
    this.customer(await this.client.customers.retrieve(customerId), attempt.customer_ref, customerId);
    this.assertRunning(signal);
    const price = priceSchema.parse(await this.client.prices.retrieve(attempt.price_id));
    if (price.id !== attempt.price_id || price.recurring.interval !== (attempt.offer_key === 'pro_monthly' ? 'month' : 'year')) throw new Error('The reference offer does not match its approved sandbox cadence.');
    const productId = referenceId(price.product);
    if (!productId) throw new Error('The reference price has no product.');
    const product = z.looseObject({ id: providerId, object: z.literal('product'), active: z.boolean(), livemode: z.literal(false) }).parse(await this.client.products.retrieve(productId));
    if (product.id !== productId) throw new Error('The canonical offer product is inconsistent.');
    this.assertRunning(signal);
    const sessions = listSchema.parse(await this.client.checkout.sessions.list({ customer: customerId, limit: 100 }));
    const candidates = sessions.data.filter(session => z.looseObject({ id: providerId, client_reference_id: z.string().nullable() }).parse(session).client_reference_id === attempt.id);
    if (sessions.has_more || candidates.length > 1) throw new TerminalJobFailure('reconciliation-required');
    let id: string;
    if (candidates.length === 1) {
      id = this.session(candidates[0], attempt, customerId, origin).id;
    } else if (replayWindow) {
      if (!price.active || !product.active) throw new TerminalJobFailure('reconciliation-required');
      const subscriptions = listSchema.parse(await this.client.subscriptions.list({ customer: customerId, status: 'all', limit: 100 }));
      if (subscriptions.has_more || subscriptions.data.map(value => subscriptionSchema.parse(value)).some(subscription => subscription.customer !== customerId ||
        !['canceled', 'incomplete_expired'].includes(subscription.status))) throw new TerminalJobFailure('reconciliation-required');
      if (parent) {
        const matches = subscriptions.data.filter(value => subscriptionSchema.parse(value).id === parent.subscriptionId);
        if (matches.length !== 1) throw new TerminalJobFailure('reconciliation-required');
        const previous = renewalSchema.parse(matches[0]), item = previous.items.data[0];
        if (previous.metadata.studio_customer_ref !== attempt.customer_ref || previous.metadata.studio_checkout_ref !== parent.attemptId ||
          item.subscription !== previous.id || item.price.id !== parent.priceId) throw new TerminalJobFailure('reconciliation-required');
      }
      await beforeMutation();
      this.assertRunning(signal);
      const session = await this.client.checkout.sessions.create({
        mode: 'subscription', ui_mode: 'hosted_page', customer: customerId, client_reference_id: attempt.id,
        line_items: [{ price: attempt.price_id, quantity: 1 }], allowed_payment_method_types: ['card'],
        allow_promotion_codes: false, automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false },
        metadata: { studio_customer_ref: attempt.customer_ref }, subscription_data: { metadata: { studio_customer_ref: attempt.customer_ref, studio_checkout_ref: attempt.id } },
        expires_at: attempt.expires_at / 1000, success_url: `${origin}/billing?attempt=${attempt.id}`,
        cancel_url: `${origin}/billing?attempt=${attempt.id}&cancelled=true`,
      }, { idempotencyKey: operationId });
      id = this.session(session, attempt, customerId, origin).id;
    } else throw new TerminalJobFailure('reconciliation-required');
    const session = await this.client.checkout.sessions.retrieve(id, { expand: ['line_items'] });
    this.assertRunning(signal);
    return { ...this.session(session, attempt, customerId, origin, true), currency: price.currency, unitAmount: price.unit_amount };
  }
}
