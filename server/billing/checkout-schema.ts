import { z } from 'zod';
import { sandboxOffers, sandboxRecheckoutAuthority } from '../../shared/billing';
import { providerId } from './schema';

const requestFields = { offer: z.enum(sandboxOffers), key: z.uuid() };
export const checkoutRequestSchema = z.union([
  z.strictObject(requestFields),
  z.strictObject({ ...requestFields, previousSubscriptionRef: z.uuid(), acknowledged: z.literal(true) }),
]);
export const customerRequestSchema = z.strictObject({ customerRef: z.uuid(), authEpoch: z.number().int().nonnegative() });
export const canonicalOriginSchema = z.string().refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password; }
  catch { return false; }
});
const operationFields = {
  attemptId: z.uuid(), customerRef: z.uuid(), priceId: providerId, offer: z.enum(sandboxOffers),
  origin: canonicalOriginSchema, expiresAt: z.number().int().positive().safe(), authEpoch: z.number().int().nonnegative(),
};
export const checkoutOperationSchema = z.union([
  z.strictObject(operationFields),
  z.strictObject({ ...operationFields, policy: z.literal(sandboxRecheckoutAuthority), previousSubscriptionRef: z.uuid(),
    previousAttemptId: z.uuid(), previousSubscriptionId: providerId, acknowledged: z.literal(true) }),
]);
export const customerRowSchema = z.object({
  id: z.uuid(), account_id: providerId, user_id: z.uuid().nullable(), customer_id: providerId.nullable(),
  state: z.enum(['reserved', 'mapped', 'retired']), auth_epoch: z.coerce.number().int().nonnegative(), operation_id: z.uuid(),
});
export const checkoutRowSchema = z.object({
  id: z.uuid(), customer_ref: z.uuid(), request_key: z.uuid(), offer_key: z.enum(sandboxOffers), price_id: providerId,
  origin: canonicalOriginSchema,
  auth_epoch: z.coerce.number().int().nonnegative(),
  state: z.enum(['waiting-customer', 'queued', 'open', 'complete', 'expired', 'retired']),
  operation_id: z.uuid().nullable(), session_id: providerId.nullable(), subscription_id: providerId.nullable(),
  refresh_operation_id: z.uuid().nullable(),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']).nullable(), hosted_url: z.string().nullable(), currency: z.literal('usd').nullable(),
  unit_amount: z.coerce.number().int().positive().safe().nullable(), expires_at: z.coerce.number().int().positive().safe(),
  previous_subscription_ref: z.uuid().nullable(), previous_attempt_id: z.uuid().nullable(),
  previous_subscription_id: providerId.nullable(), recheckout_acknowledged: z.literal(1).nullable(),
}).refine(row => row.previous_subscription_ref === null ?
  row.previous_attempt_id === null && row.previous_subscription_id === null && row.recheckout_acknowledged === null :
  row.previous_attempt_id !== null && row.previous_subscription_id !== null && row.recheckout_acknowledged === 1 &&
  row.previous_attempt_id !== row.id, 'Recheckout requires coherent immutable acknowledged predecessor scope.');
export type CustomerRow = z.infer<typeof customerRowSchema>;
export type CheckoutRow = z.infer<typeof checkoutRowSchema>;
const reference = z.union([providerId, z.looseObject({ id: providerId })]).nullable();
export const customerSchema = z.looseObject({
  id: providerId, object: z.literal('customer'), livemode: z.literal(false),
  deleted: z.literal(false).optional(),
  metadata: z.looseObject({ studio_customer_ref: z.uuid() }),
});
export const checkoutSchema = z.looseObject({
  id: providerId, object: z.literal('checkout.session'), livemode: z.literal(false),
  mode: z.literal('subscription'), ui_mode: z.literal('hosted_page'),
  customer: reference, client_reference_id: z.uuid(), metadata: z.looseObject({ studio_customer_ref: z.uuid() }),
  status: z.enum(['open', 'complete', 'expired']), payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  subscription: reference, expires_at: z.number().int().positive(), url: z.string().nullable(),
  success_url: z.string(), cancel_url: z.string(),
  line_items: z.looseObject({ has_more: z.boolean(), data: z.array(z.looseObject({
    quantity: z.literal(1), currency: z.literal('usd'), price: z.looseObject({ id: providerId }).nullable(),
  })).max(100) }).optional(),
});
export const priceSchema = z.looseObject({
  id: providerId, object: z.literal('price'), active: z.boolean(), livemode: z.literal(false),
  type: z.literal('recurring'), billing_scheme: z.literal('per_unit'), currency: z.literal('usd'),
  unit_amount: z.number().int().positive().safe(), product: reference,
  recurring: z.looseObject({ interval: z.enum(['month', 'year']), interval_count: z.literal(1), usage_type: z.literal('licensed') }),
});
export function hostedCheckoutUrl(value: string) {
  const url = new URL(value);
  if (value.length > 8192 || /[\x00-\x20\x7f]/.test(value) || url.origin !== 'https://checkout.stripe.com' ||
    url.username || url.password || !url.pathname.startsWith('/c/pay/')) throw new Error('The sandbox checkout URL is not an approved hosted destination.');
  return value;
}
