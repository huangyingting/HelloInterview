import { z } from 'zod';
import { providerId } from './schema';
import { canonicalOriginSchema } from './checkout-schema';
import { encodePayload } from '../jobs/schema';

export const portalAuthority = 'sandbox-restricted-portal-v1' as const;
export const portalScopeSchema = z.strictObject({
  id: z.uuid(), owner: z.uuid(), customerRef: z.uuid(), customerId: providerId,
  configurationId: z.string().regex(/^bpc_[A-Za-z0-9]{1,100}$/), origin: canonicalOriginSchema,
  authEpoch: z.number().int().nonnegative().safe(), createdAt: z.date(),
});
export type PortalScope = z.infer<typeof portalScopeSchema>;
export const portalConfigurationSchema = z.looseObject({
  id: providerId, object: z.literal('billing_portal.configuration'), active: z.literal(true), livemode: z.literal(false), application: z.null(),
  features: z.strictObject({
    customer_update: z.looseObject({ enabled: z.literal(false), allowed_updates: z.array(z.never()).length(0) }),
    invoice_history: z.looseObject({ enabled: z.literal(true) }),
    payment_method_update: z.looseObject({ enabled: z.literal(true), payment_method_configuration: z.string().regex(/^pmc_[A-Za-z0-9]{1,100}$/) }),
    subscription_cancel: z.looseObject({ enabled: z.literal(false) }),
    subscription_update: z.looseObject({ enabled: z.literal(false) }),
  }),
  login_page: z.looseObject({ enabled: z.literal(false), url: z.null() }),
});
const methodSchema = z.looseObject({
  available: z.boolean(), display_preference: z.looseObject({ value: z.enum(['on', 'off']) }),
});
export function cardOnlyConfiguration(value: unknown, id: string) {
  const configuration = z.looseObject({ id: providerId, object: z.literal('payment_method_configuration'),
    active: z.literal(true), livemode: z.literal(false), application: z.null(), parent: z.null(),
    is_default: z.boolean(), name: z.string().max(500), card: methodSchema }).parse(value);
  if (configuration.id !== id || !configuration.card.available || configuration.card.display_preference.value !== 'on') throw new Error('The restricted portal requires an explicit active sandbox card configuration.');
  const headers = ['id', 'object', 'active', 'livemode', 'application', 'parent', 'is_default', 'name'];
  const methods: Record<string, { available: boolean; value: string } | null> = {};
  if (Object.keys(configuration).length > 100) throw new Error('The payment-method policy exceeds its supported object bound.');
  for (const [key, value] of Object.entries(configuration)) {
    if (headers.includes(key)) continue;
    const method = methodSchema.nullable().parse(value);
    if (key !== 'card' && method && (method.available || method.display_preference.value !== 'off')) {
      throw new Error('The restricted sandbox portal must disable every non-card method, including wallets and future method families.');
    }
    methods[key] = method ? { available: method.available, value: method.display_preference.value } : null;
  }
  return encodePayload({ id, methods }, 8192);
}
export function hostedPortalUrl(value: string) {
  const url = new URL(value), secret = url.searchParams.get('secret');
  if (value.length > 8192 || /[\x00-\x20\x7f]/.test(value) || url.origin !== 'https://billing.stripe.com' ||
    url.username || url.password || url.pathname !== '/p/session' || url.hash ||
    url.searchParams.size !== 1 || !secret || !/^test_[A-Za-z0-9_-]{8,4096}$/.test(secret)) {
    throw new Error('The provider returned an unsupported sandbox portal destination.');
  }
  return value;
}
export const portalSessionSchema = z.looseObject({
  id: z.string().regex(/^bps_[A-Za-z0-9]{1,100}$/), object: z.literal('billing_portal.session'), customer: providerId,
  customer_account: z.null(), configuration: z.union([providerId, z.looseObject({ id: providerId })]),
  created: z.number().int().nonnegative().max(253402300799), livemode: z.literal(false), on_behalf_of: z.null(),
  flow: z.null(), return_url: z.string(), url: z.string().max(8192),
});
