import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadManagedAiConfig, ManagedAiConfigurationError } from '../server/ai/config';
import { AuthConfigurationError, invitationHash, loadAuthSettings } from '../server/auth/config';
import { loadBillingConfig } from '../server/billing/config';
import { loadParticipantPolicy, privateBetaDurabilityNotice } from '../server/participant-policy';
import { loadServicePreflightConfig, ServicePreflightConfigurationError } from '../server/preflight/config';

const auth = {
  NEXTAUTH_URL: 'https://studio.fixture',
  NEXTAUTH_SECRET: 'fixture-auth-secret-fixture-auth-secret',
  AUTH_GOOGLE_CLIENT_ID: 'fixture-google-client',
  AUTH_GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
  AUTH_FACEBOOK_CLIENT_ID: '123456789',
  AUTH_FACEBOOK_CLIENT_SECRET: 'fixture-facebook-secret',
  AUTH_INVITED_EMAILS: 'Owner@Example.invalid,second@example.invalid',
  AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
};
const policy = {
  PRIVACY_CONTROLLER_NAME: 'Synthetic Studio Operator',
  PRIVACY_CONTACT_URL: 'mailto:privacy@example.invalid',
  PARTICIPANT_MINIMUM_AGE: '18',
  PRIVACY_RETENTION_NOTICE: 'Synthetic records are retained for a bounded fixture period.',
  PRIVACY_DELETION_NOTICE: 'Synthetic deletion requests are completed within a bounded fixture period.',
  PRIVATE_BETA_NO_DURABILITY_ACK: 'true',
};
const fail = (setting: string, requirement: string): never => {
  throw new ServicePreflightConfigurationError(setting, requirement);
};

test('Auth.js social identity configuration is complete, immutable and invitation-minimized', () => {
  assert.equal(loadAuthSettings({}), null);
  const settings = loadAuthSettings(auth);
  assert.ok(settings);
  assert.equal(settings.origin, 'https://studio.fixture');
  assert.deepEqual(settings.inviteEmailHashes, [
    invitationHash(auth.NEXTAUTH_SECRET, 'owner@example.invalid'),
    invitationHash(auth.NEXTAUTH_SECRET, 'second@example.invalid'),
  ]);
  assert.equal(JSON.stringify(settings).toLowerCase().includes('owner@example.invalid'), false);
  assert.ok(Object.isFrozen(settings));
  assert.ok(Object.isFrozen(settings.google));
  assert.ok(Object.isFrozen(settings.facebook));
  assert.ok(Object.isFrozen(settings.inviteEmailHashes));
  for (const override of [
    { NEXTAUTH_URL: 'http://studio.fixture' },
    { NEXTAUTH_SECRET: 'short' },
    { AUTH_GOOGLE_CLIENT_SECRET: 'unsafe secret' },
    { AUTH_FACEBOOK_CLIENT_ID: 'facebook-client' },
    { AUTH_INVITED_EMAILS: 'same@example.invalid,SAME@example.invalid' },
    { AUTH_MFA_ENCRYPTION_KEY: 'invalid' },
  ]) assert.throws(() => loadAuthSettings({ ...auth, ...override }), AuthConfigurationError);
});

test('participant policy is complete, bounded and explicitly acknowledges private-beta durability', () => {
  const value = loadParticipantPolicy(policy, fail);
  assert.deepEqual(value, {
    controllerName: 'Synthetic Studio Operator',
    contactUrl: 'mailto:privacy@example.invalid',
    minimumAge: 18,
    retentionNotice: policy.PRIVACY_RETENTION_NOTICE,
    deletionNotice: policy.PRIVACY_DELETION_NOTICE,
    durabilityNotice: privateBetaDurabilityNotice,
  });
  assert.ok(Object.isFrozen(value));
  for (const override of [
    { PRIVACY_CONTROLLER_NAME: undefined },
    { PRIVACY_CONTACT_URL: 'http://example.invalid' },
    { PARTICIPANT_MINIMUM_AGE: '12' },
    { PRIVACY_RETENTION_NOTICE: 'short' },
    { PRIVATE_BETA_NO_DURABILITY_ACK: 'false' },
  ]) assert.throws(() => loadParticipantPolicy({ ...policy, ...override }, fail), ServicePreflightConfigurationError);
});

test('managed AI and sandbox billing remain explicit, bounded and independently optional', () => {
  assert.equal(loadManagedAiConfig({}), null);
  const ai = loadManagedAiConfig({
    MANAGED_AI_ENABLED: 'true',
    MANAGED_AI_MODEL_REVISION: 'fixture-revision-1',
    AZURE_OPENAI_API_KEY: 'fixture-only',
    AZURE_OPENAI_ENDPOINT: 'https://fixture.openai.azure.com',
    AZURE_OPENAI_DEPLOYMENT: 'gpt-4.1-mini',
    AZURE_OPENAI_API_VERSION: '2025-04-01-preview',
    MANAGED_AI_INPUT_PRICE_MICROS_PER_MILLION_TOKENS: '1000',
    MANAGED_AI_OUTPUT_PRICE_MICROS_PER_MILLION_TOKENS: '4000',
    MANAGED_AI_DATA_USE_NOTICE: 'Synthetic prompts are sent to the configured Azure deployment for evaluation.',
  });
  assert.equal(ai?.provider.deployment, 'gpt-4.1-mini');
  assert.ok(Object.isFrozen(ai));
  assert.throws(() => loadManagedAiConfig({ MANAGED_AI_ENABLED: 'true' }), ManagedAiConfigurationError);

  const stripe = {
    STRIPE_TEST_ACCOUNT_ID: 'acct_SyntheticFixture',
    STRIPE_TEST_SECRET_KEY: 'rk_test_SyntheticFixtureOnly',
    STRIPE_TEST_WEBHOOK_SECRET: 'whsec_SyntheticFixtureOnly',
    STRIPE_TEST_OFFERS: '{"pro_monthly":"price_SyntheticMonthly","pro_annual":"price_SyntheticAnnual"}',
  };
  const billing = loadBillingConfig(stripe, {
    identity: true,
    databaseUrl: 'postgresql://localhost/studio',
    publicOrigin: 'https://studio.fixture',
  }, fail);
  assert.equal(billing?.accountId, stripe.STRIPE_TEST_ACCOUNT_ID);
  assert.ok(Object.isFrozen(billing));
  assert.ok(Object.isFrozen(billing?.offers));
  assert.throws(() => loadBillingConfig(stripe, {
    identity: false,
    databaseUrl: 'postgresql://localhost/studio',
    publicOrigin: 'https://studio.fixture',
  }, fail), ServicePreflightConfigurationError);
});

test('operated-service preflight requires PostgreSQL, trusted ingress, Auth.js and participant policy', () => {
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/studio',
    TRUST_PROXY: '127.0.0.1/32,10.10.0.0/16',
    HOSTNAME: 'studio.internal',
    PORT: '3000',
    ...auth,
    ...policy,
  };
  const config = loadServicePreflightConfig(env);
  assert.equal(config.databaseUrl, env.DATABASE_URL);
  assert.equal(config.auth.origin, 'https://studio.fixture');
  assert.deepEqual(config.trustedProxies, ['127.0.0.1/32', '10.10.0.0/16']);
  assert.equal(config.ai, null);
  assert.equal(config.billing, null);
  assert.ok(Object.isFrozen(config));
  for (const override of [
    { NODE_ENV: 'test' },
    { DATABASE_URL: 'file:studio.db' },
    { TRUST_PROXY: undefined },
    { NEXTAUTH_SECRET: undefined },
    { PRIVACY_CONTROLLER_NAME: undefined },
    { PORT: '65536' },
  ]) assert.throws(() => loadServicePreflightConfig({ ...env, ...override }), Error);
});
