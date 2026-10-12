import { z } from 'zod';
import type Stripe from 'stripe';
import { digest, encodePayload } from '../jobs/schema';

export const stripeApiVersion = '2026-09-30.endive' as const;
export const providerId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{1,199}$/);
export const objectKinds = ['checkout.session', 'subscription', 'invoice', 'charge', 'refund', 'dispute', 'credit_note'] as const;
export type ObjectKind = typeof objectKinds[number];
export class InvalidBillingNotification extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidBillingNotification'; }
}
const eventObjects: Readonly<Record<string, ObjectKind>> = {
  'checkout.session.completed': 'checkout.session',
  'checkout.session.async_payment_succeeded': 'checkout.session',
  'checkout.session.async_payment_failed': 'checkout.session',
  'checkout.session.expired': 'checkout.session',
  'customer.subscription.created': 'subscription',
  'customer.subscription.updated': 'subscription',
  'customer.subscription.deleted': 'subscription',
  'invoice.paid': 'invoice',
  'invoice.payment_failed': 'invoice',
  'invoice.payment_action_required': 'invoice',
  'invoice.finalization_failed': 'invoice',
  'charge.refunded': 'charge',
  'refund.created': 'refund',
  'refund.updated': 'refund',
  'refund.failed': 'refund',
  'charge.dispute.created': 'dispute',
  'charge.dispute.updated': 'dispute',
  'charge.dispute.closed': 'dispute',
  'credit_note.created': 'credit_note',
  'credit_note.updated': 'credit_note',
  'credit_note.voided': 'credit_note',
} satisfies Partial<Record<Stripe.Event.Type, ObjectKind>>;
const eventSchema = z.looseObject({
  id: providerId, object: z.literal('event'), type: z.string().regex(/^[a-z0-9_.]{1,200}$/),
  api_version: z.literal(stripeApiVersion), livemode: z.literal(false),
  created: z.number().int().nonnegative().max(253402300799),
  account: z.string().optional(), context: z.string().optional(),
  data: z.looseObject({ object: z.looseObject({ id: providerId, object: z.string().regex(/^[a-z0-9_.]{1,100}$/) }) }),
});
export const notificationSchema = z.strictObject({
  accountId: providerId, eventId: providerId, eventType: eventSchema.shape.type,
  apiVersion: z.literal(stripeApiVersion), livemode: z.literal(false),
  created: eventSchema.shape.created, objectId: providerId, objectKind: z.string().regex(/^[a-z0-9_.]{1,100}$/),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), classification: z.enum(['supported', 'unsupported']),
});
export type Notification = z.infer<typeof notificationSchema>;
export function notification(value: unknown, accountId: string): Notification {
  // Validate original JSON before schema parsing can discard prohibited keys.
  encodePayload({ event: value });
  const event = eventSchema.parse(value), object = event.data.object;
  if (event.account !== undefined || event.context !== undefined) throw new InvalidBillingNotification('Connected-account and organization events are not supported by this own-account reference.');
  const expected = Object.hasOwn(eventObjects, event.type) ? eventObjects[event.type] : undefined;
  if (expected && expected !== object.object) throw new InvalidBillingNotification('The event object does not match the supported billing event family.');
  return notificationSchema.parse({
    accountId, eventId: event.id, eventType: event.type, apiVersion: event.api_version, livemode: event.livemode,
    created: event.created, objectId: object.id, objectKind: object.object,
    snapshotHash: digest(encodePayload({ object })), classification: expected ? 'supported' : 'unsupported',
  });
}
const reference = z.union([providerId, z.looseObject({ id: providerId })]).nullable();
export function referenceId(value: z.infer<typeof reference> | undefined) {
  return value === undefined || value === null ? null : typeof value === 'string' ? value : value.id;
}
export const canonicalObjectSchema = z.looseObject({
  id: providerId, object: z.enum(objectKinds), livemode: z.literal(false).optional(),
  customer: reference.optional(), subscription: reference.optional(), charge: reference.optional(),
  status: z.string().min(1).max(100).nullable().optional(), currency: z.string().regex(/^[a-z]{3}$/).nullable().optional(),
  amount: z.number().int().nonnegative().safe().optional(),
  amount_paid: z.number().int().nonnegative().safe().optional(),
  amount_total: z.number().int().nonnegative().safe().nullable().optional(),
  amount_refunded: z.number().int().nonnegative().safe().optional(), paid: z.boolean().optional(),
  parent: z.looseObject({ subscription_details: z.looseObject({ subscription: reference }).nullable().optional() }).nullable().optional(),
});
export const observationSchema = z.strictObject({
  accountId: providerId, eventId: providerId, objectId: providerId, objectKind: z.enum(objectKinds),
  customerId: providerId.nullable(), subscriptionId: providerId.nullable(), chargeId: providerId.nullable(),
  status: z.string().min(1).max(100).nullable(), currency: z.string().regex(/^[a-z]{3}$/).nullable(),
  amount: z.number().int().nonnegative().safe().nullable(), amountRefunded: z.number().int().nonnegative().safe().nullable(),
  paid: z.boolean().nullable(),
});
export type Observation = z.infer<typeof observationSchema>;
