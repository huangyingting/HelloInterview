import { z } from 'zod';
import { sandboxServicePolicy } from '../../shared/billing-ledger';

export interface BillingConfig {
  readonly accountId: string;
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly offers: Readonly<{ pro_monthly: string; pro_annual: string }> | null;
  readonly accessPolicy: typeof sandboxServicePolicy | null;
  readonly portalConfiguration: string | null;
}

type ConfigurationFailure = (setting: string, requirement: string) => never;

export function loadBillingConfig(
  env: NodeJS.ProcessEnv,
  prerequisites: Readonly<{ identity: boolean; databaseUrl: string | null; publicOrigin: string | null }>,
  fail: ConfigurationFailure,
): Readonly<BillingConfig> | null {
  const billingSettings = ['STRIPE_TEST_ACCOUNT_ID', 'STRIPE_TEST_SECRET_KEY', 'STRIPE_TEST_WEBHOOK_SECRET',
    'STRIPE_TEST_OFFERS', 'STRIPE_TEST_ACCESS_POLICY', 'STRIPE_TEST_PORTAL_CONFIGURATION'];
  const providedBillingSettings = Object.keys(env).filter(key => key.startsWith('STRIPE_') && env[key] !== undefined);
  if (!providedBillingSettings.length) return null;
  if (providedBillingSettings.some(key => !billingSettings.includes(key))) {
    fail('Stripe configuration', 'contains an unsupported setting; live billing is not enabled.');
  }
  if (!prerequisites.identity || !prerequisites.databaseUrl || !prerequisites.publicOrigin?.startsWith('https://')) {
    fail('Stripe configuration', 'requires managed identity, PostgreSQL and a canonical HTTPS origin.');
  }
  const accountId = env.STRIPE_TEST_ACCOUNT_ID;
  const secretKey = env.STRIPE_TEST_SECRET_KEY;
  const webhookSecret = env.STRIPE_TEST_WEBHOOK_SECRET;
  if (!accountId || !/^acct_[A-Za-z0-9]{1,100}$/.test(accountId)) {
    fail('STRIPE_TEST_ACCOUNT_ID', 'must be an explicit reference account identifier.');
  }
  if (!secretKey || !/^(?:sk|rk)_test_[A-Za-z0-9]{8,200}$/.test(secretKey)) {
    fail('STRIPE_TEST_SECRET_KEY', 'must be a test-mode SDK key; live keys are refused.');
  }
  if (!webhookSecret || !/^whsec_[A-Za-z0-9]{8,200}$/.test(webhookSecret)) {
    fail('STRIPE_TEST_WEBHOOK_SECRET', 'must be the private signing secret for the own-account snapshot endpoint.');
  }
  let offers: BillingConfig['offers'] = null;
  if (env.STRIPE_TEST_OFFERS !== undefined) {
    try {
      const price = z.string().regex(/^price_[A-Za-z0-9]{1,100}$/);
      const parsed = z.strictObject({ pro_monthly: price, pro_annual: price }).parse(JSON.parse(env.STRIPE_TEST_OFFERS));
      if (parsed.pro_monthly === parsed.pro_annual) {
        fail('STRIPE_TEST_OFFERS', 'must use distinct allowlisted reference prices.');
      }
      offers = Object.freeze(parsed);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        fail('STRIPE_TEST_OFFERS', 'must map exactly pro_monthly and pro_annual to distinct sandbox Price IDs.');
      }
      throw error;
    }
  }
  if (env.STRIPE_TEST_ACCESS_POLICY !== undefined && env.STRIPE_TEST_ACCESS_POLICY !== sandboxServicePolicy) {
    fail('STRIPE_TEST_ACCESS_POLICY', 'must select the explicit sandbox-only service policy; real commerce remains disabled.');
  }
  const portalConfiguration = env.STRIPE_TEST_PORTAL_CONFIGURATION;
  if (portalConfiguration !== undefined && !/^bpc_[A-Za-z0-9]{1,100}$/.test(portalConfiguration)) {
    fail('STRIPE_TEST_PORTAL_CONFIGURATION', 'must identify an explicit restricted sandbox Portal configuration.');
  }
  return Object.freeze({
    accountId,
    secretKey,
    webhookSecret,
    offers,
    accessPolicy: env.STRIPE_TEST_ACCESS_POLICY === undefined ? null : sandboxServicePolicy,
    portalConfiguration: portalConfiguration ?? null,
  });
}
