import Stripe from 'stripe';
import type { BillingConfig } from '../config';
import { encodePayload } from '../jobs/schema';
import { canonicalObjectSchema, notification, observationSchema, referenceId, stripeApiVersion, type Notification, type Observation } from './schema';

export class StripeEvidence {
  private readonly client: Stripe;
  constructor(private readonly settings: BillingConfig, private readonly shutdown: AbortSignal, client?: Stripe) {
    if (Stripe.API_VERSION !== stripeApiVersion) throw new Error('The Stripe SDK and reference API versions do not match.');
    this.client = client ?? new Stripe(settings.secretKey, { apiVersion: stripeApiVersion, timeout: 5000, maxNetworkRetries: 0 });
  }
  verify(body: Buffer, signature: string) {
    return this.client.webhooks.constructEvent(body, signature, this.settings.webhookSecret, 300);
  }
  private assertRunning(signal?: AbortSignal) { this.shutdown.throwIfAborted(); signal?.throwIfAborted(); }
  async observe(input: Notification, signal?: AbortSignal): Promise<Observation> {
    this.assertRunning(signal);
    const account = await this.client.accounts.retrieve(null);
    this.assertRunning(signal);
    if (account.id !== this.settings.accountId || account.object !== 'account') throw new Error('The canonical provider account does not match the configured reference.');
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
}
