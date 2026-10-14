import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { ConfigurationError, loadConfig } from '../server/config';

test('configuration defaults preserve loopback, local data, cookies and optional AI', () => {
  const config = loadConfig({}, '/tmp/studio-config-fixture');
  assert.deepEqual(config, {
    environment: 'development',
    appMode: 'local',
    rootDir: '/tmp/studio-config-fixture',
    frontendDir: '/tmp/studio-config-fixture/dist',
    retainedFrontendDirs: [],
    dataDir: '/tmp/studio-config-fixture/data',
    databaseUrl: null,
    publicOrigin: null,
    trustedProxies: [],
    logRequests: false,
    fieldMetrics: false,
    host: '127.0.0.1',
    port: 3000,
    cookieSecure: false,
    ai: null,
    identity: null,
    billing: null,
  });
});

test('configuration resolves paths and accepts explicit runtime settings and IPv6', () => {
  const config = loadConfig({ NODE_ENV: 'production', HOST: '::1', PORT: '0', COOKIE_SECURE: 'true', DATA_DIR: 'private-data' });
  assert.equal(config.environment, 'production');
  assert.equal(config.host, '::1');
  assert.equal(config.port, 0);
  assert.equal(config.cookieSecure, true);
  assert.equal(loadConfig({ FIELD_METRICS_ENABLED: 'true' }).fieldMetrics, true);
  assert.equal(config.dataDir, path.resolve('private-data'));
  assert.equal(loadConfig({ DATA_DIR: '/tmp/studio-absolute-data' }).dataDir, '/tmp/studio-absolute-data');
  assert.equal(loadConfig({ HOST: 'localhost', PORT: '65535' }).port, 65535);
  assert.equal(loadConfig({ HOST: 'studio.internal' }).host, 'studio.internal');
  assert.deepEqual(loadConfig({RETAINED_FRONTEND_DIRS:`release-a${path.delimiter}/tmp/release-b`},'/srv/studio').retainedFrontendDirs,['/srv/studio/release-a','/tmp/release-b']);
  assert.throws(()=>loadConfig({RETAINED_FRONTEND_DIRS:`dist${path.delimiter}dist`},'/srv/studio'),/RETAINED_FRONTEND_DIRS/);
});

test('optional AI configuration normalizes the endpoint without leaking it to client capabilities', () => {
  assert.equal(loadConfig({ OPENAI_API_KEY: '', OPENAI_BASE_URL: '', OPENAI_MODEL: '' }).ai, null);
  assert.deepEqual(loadConfig({ OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1///', OPENAI_MODEL: 'fixture-model' }).ai, {
    provider: 'openai',
    apiKey: 'fixture-only',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'fixture-model',
    apiVersion: null,
  });
  assert.deepEqual(loadConfig({AZURE_OPENAI_API_KEY:'fixture-only',AZURE_OPENAI_ENDPOINT:'https://fixture.openai.azure.com',AZURE_OPENAI_DEPLOYMENT:'gpt-4.1-mini',AZURE_OPENAI_API_VERSION:'2025-04-01-preview'}).ai,{
    provider:'azure-openai',apiKey:'fixture-only',baseUrl:'https://fixture.openai.azure.com/openai/deployments/gpt-4.1-mini',model:'gpt-4.1-mini',apiVersion:'2025-04-01-preview',
  });
  assert.throws(()=>loadConfig({AZURE_OPENAI_API_KEY:'fixture-only'}),/AZURE_OPENAI_DEPLOYMENT/);
  assert.throws(()=>loadConfig({AZURE_OPENAI_API_KEY:'fixture-only',AZURE_OPENAI_ENDPOINT:'https://fixture.openai.azure.com',AZURE_OPENAI_DEPLOYMENT:'deployment',AZURE_OPENAI_API_VERSION:'2025-04-01-preview',OPENAI_MODEL:'mixed'}),/either OPENAI/);
  assert.equal(loadConfig({ OPENAI_API_KEY: 'fixture-only' }).ai?.baseUrl, 'https://api.openai.com/v1');
});

test('configuration is an immutable snapshot, not a live reference to process environment', () => {
  const env = { PORT: '3100', OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'original-model' };
  const config = loadConfig(env);
  env.PORT = '3200';
  env.OPENAI_MODEL = 'changed-model';
  assert.equal(config.port, 3100);
  assert.equal(config.ai?.model, 'original-model');
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.ai));
});

test('service mode requires the complete approved private-beta authority while local proxy configuration stays explicit', () => {
  const service = {
    NODE_ENV: 'production', APP_MODE: 'service', DATABASE_URL: 'postgres://localhost/synthetic_fixture',
    PUBLIC_ORIGIN: 'https://studio.fixture', COOKIE_SECURE: 'true', TRUST_PROXY: '127.0.0.1/32',
    OIDC_ISSUER: 'https://broker.fixture/', OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-secret',
    OIDC_MANAGEMENT_ORIGIN: 'https://broker.fixture', OIDC_MANAGEMENT_CLIENT_ID: 'synthetic-manager',
    OIDC_MANAGEMENT_CLIENT_SECRET: 'synthetic-manager-secret', OIDC_PASSWORD_HOOK_SECRET: '1'.repeat(64),
    OIDC_INVITED_EMAILS: 'Owner@Example.invalid, second@example.invalid',
  };
  const serviceConfig = loadConfig(service);
  assert.equal(serviceConfig.appMode, 'service');
  assert.equal(serviceConfig.identity?.inviteEmailHashes?.length, 2);
  assert.ok(Object.isFrozen(serviceConfig.identity?.inviteEmailHashes));
  assert.ok(!JSON.stringify(serviceConfig.identity).toLowerCase().includes('owner@example.invalid'));
  for (const override of [
    { NODE_ENV: 'test' }, { OIDC_ISSUER: undefined }, { OIDC_MANAGEMENT_ORIGIN: undefined },
    { OIDC_INVITED_EMAILS: undefined }, { OIDC_INVITED_EMAILS: '' }, { OIDC_INVITED_EMAILS: 'duplicate@example.invalid,DUPLICATE@example.invalid' },
    { OIDC_LEGACY_LINK_UNTIL: new Date(Date.now() + 86400000).toISOString() }, { TRUST_PROXY: undefined },
    { LOG_REQUESTS: 'false' }, { OPENAI_API_KEY: 'fixture-only' }, { OPENAI_MODEL: 'fixture-model' },
    { STRIPE_TEST_ACCOUNT_ID: 'acct_SyntheticFixture', STRIPE_TEST_SECRET_KEY: 'rk_test_SyntheticFixtureOnly',
      STRIPE_TEST_WEBHOOK_SECRET: 'whsec_SyntheticFixtureOnly' },
  ]) assert.throws(() => loadConfig({ ...service, ...override }), ConfigurationError);
  const env = { PUBLIC_ORIGIN: 'https://Studio.Example:443/', COOKIE_SECURE: 'true', TRUST_PROXY: '127.0.0.1, 10.10.0.0/16, ::1/128', LOG_REQUESTS: 'true' };
  const config = loadConfig(env);
  assert.equal(config.publicOrigin, 'https://studio.example');
  assert.deepEqual(config.trustedProxies, ['127.0.0.1', '10.10.0.0/16', '::1/128']);
  assert.equal(config.logRequests, true);
  assert.ok(Object.isFrozen(config.trustedProxies));
  env.TRUST_PROXY = '192.0.2.1';
  assert.equal(config.trustedProxies[0], '127.0.0.1');
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'https://studio.example' }), /COOKIE_SECURE must be true/);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'http://studio.example', COOKIE_SECURE: 'true' }), /PUBLIC_ORIGIN must use HTTPS/);
  assert.throws(() => loadConfig({ TRUST_PROXY: '0.0.0.0/0' }), /TRUST_PROXY/);
});

test('invalid settings fail explicitly without putting their values in the error message', () => {
  const invalid: [string, string[]][] = [
    ['NODE_ENV', ['', 'prod', 'staging']],
    ['APP_MODE', ['', 'prod', 'public']],
    ['PORT', ['', '-1', '65536', '1.5', '1e3', 'NaN', 'Infinity', '3000oops', ' 3000', '9007199254740993']],
    ['HOST', ['', 'https://example.com', 'localhost:3000', '[::1]', '127.0.0.999', '-bad-host', 'bad host', 'host/path']],
    ['COOKIE_SECURE', ['', '1', 'yes', 'TRUE', 'false ']],
    ['LOG_REQUESTS', ['', '1', 'yes', 'TRUE']],
    ['FIELD_METRICS_ENABLED', ['', '1', 'yes', 'TRUE']],
    ['PUBLIC_ORIGIN', ['', 'ftp://example.com', 'https://example.com/path', 'https://example.com/?', 'https://example.com/#', 'https://user:fixture@example.com']],
    ['TRUST_PROXY', ['', 'true', 'false', '1', 'loopback', '127.0.0.1/33', '::1/129', '127.0.0.1/-1', '127.0.0.1/24/1']],
    ['DATA_DIR', ['', '   ', 'data\0invalid']],
    ['DATABASE_URL', ['', 'sqlite:///tmp/studio.sqlite', 'postgres://localhost', 'postgres://localhost/', 'postgres://localhost/studio#fragment', 'postgres://bad host/studio']],
    ['OPENAI_BASE_URL', ['not-a-url', 'file:///tmp/provider', 'https://user:fixture-password@example.com/v1', 'https://example.com/v1?key=fixture-key', 'https://example.com/v1#fragment', 'https://example.com/v1?', 'https://example.com/v1#', 'https://exam\nple.com/v1']],
    ['OPENAI_MODEL', ['invalid model', 'invalid\nmodel', 'm'.repeat(201)]],
    ['OPENAI_API_KEY', ['fixture\nkey', 'fixture key']],
  ];
  for (const [setting, values] of invalid) {
    for (const value of values) {
      assert.throws(() => loadConfig({ [setting]: value }), error => {
        assert.ok(error instanceof ConfigurationError);
        assert.match(error.message, new RegExp(`^${setting} `));
        if (value.trim().length > 6) assert.ok(!error.message.includes(value));
        return true;
      }, `${setting} should reject ${JSON.stringify(value)}`);
    }
  }
});

test('managed identity requires an explicit HTTPS PostgreSQL deployment and immutable broker configuration', () => {
  const env = {
    DATABASE_URL: 'postgres://localhost/synthetic_fixture', PUBLIC_ORIGIN: 'https://studio.fixture', COOKIE_SECURE: 'true',
    OIDC_ISSUER: 'https://broker.fixture/', OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-secret',
  };
  const config = loadConfig(env);
  assert.equal(config.identity?.issuer, 'https://broker.fixture/');
  assert.equal(config.identity?.connections.github, 'github');
  assert.equal(config.identity?.inviteEmailHashes, null);
  assert.equal(config.identity?.legacyLinkUntil, null);
  assert.equal(config.identity?.lifecycle, null);
  assert.ok(Object.isFrozen(config.identity));
  assert.ok(Object.isFrozen(config.identity?.connections));
  for (const override of [
    { DATABASE_URL: undefined }, { PUBLIC_ORIGIN: undefined }, { COOKIE_SECURE: 'false' },
    { OIDC_ISSUER: 'http://broker.fixture/' }, { OIDC_ISSUER: 'https://broker.fixture/path' },
    { OIDC_ISSUER: 'https://broker.fixture/?' }, { OIDC_ISSUER: 'https://broker.fixture/#' },
    { OIDC_CLIENT_ID: '' }, { OIDC_CLIENT_SECRET: 'unsafe secret' }, { OIDC_CLIENT_SECRET: '' },
    { OIDC_EXTRA_SETTING: 'unsupported' }, { OIDC_EMAIL_CONNECTION: 'unsafe connection' },
    { OIDC_LEGACY_LINK_UNTIL: '2099-01-01T00:00:00Z' }, { OIDC_LEGACY_LINK_UNTIL: '2020-01-01T00:00:00Z' },
  ]) assert.throws(() => loadConfig({ ...env, ...override }), ConfigurationError);
  assert.throws(() => loadConfig({ OIDC_CLIENT_ID: 'synthetic-client' }), /OIDC_ISSUER/);
  env.OIDC_CLIENT_SECRET = 'changed-secret';
  assert.equal(config.identity?.clientSecret, 'synthetic-secret');
  assert.ok(loadConfig({ ...env, OIDC_LEGACY_LINK_UNTIL: new Date(Date.now() + 86400000).toISOString() }).identity?.legacyLinkUntil);
});

test('identity lifecycle requires separate read-only machine credentials and a private signing key', () => {
  const env = {
    DATABASE_URL: 'postgres://localhost/synthetic_fixture', PUBLIC_ORIGIN: 'https://studio.fixture', COOKIE_SECURE: 'true',
    OIDC_ISSUER: 'https://broker.fixture/', OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-secret',
    OIDC_MANAGEMENT_ORIGIN: 'https://broker.fixture', OIDC_MANAGEMENT_CLIENT_ID: 'synthetic-manager',
    OIDC_MANAGEMENT_CLIENT_SECRET: 'synthetic-manager-secret', OIDC_PASSWORD_HOOK_SECRET: '1'.repeat(64),
  };
  const config = loadConfig(env);
  assert.ok(Object.isFrozen(config.identity?.lifecycle));
  for (const override of [
    { OIDC_MANAGEMENT_ORIGIN: undefined }, { OIDC_MANAGEMENT_ORIGIN: 'http://broker.fixture' },
    { OIDC_MANAGEMENT_ORIGIN: 'https://broker.fixture/path' }, { OIDC_MANAGEMENT_CLIENT_ID: 'synthetic-client' },
    { OIDC_MANAGEMENT_CLIENT_SECRET: undefined }, { OIDC_PASSWORD_HOOK_SECRET: 'short' },
  ]) assert.throws(() => loadConfig({ ...env, ...override }), ConfigurationError);
});

test('managed invitations are immutable fingerprints and reject malformed or duplicate addresses without echoing them', () => {
  const env = {
    DATABASE_URL: 'postgres://localhost/synthetic_fixture', PUBLIC_ORIGIN: 'https://studio.fixture', COOKIE_SECURE: 'true',
    OIDC_ISSUER: 'https://broker.fixture/', OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-secret',
    OIDC_INVITED_EMAILS: 'First@Example.invalid, second@example.invalid',
  };
  const config = loadConfig(env);
  assert.equal(config.identity?.inviteEmailHashes?.length, 2);
  assert.ok(config.identity?.inviteEmailHashes?.every(value => /^[a-f0-9]{64}$/.test(value)));
  env.OIDC_INVITED_EMAILS = 'changed@example.invalid';
  assert.equal(config.identity?.inviteEmailHashes?.length, 2);
  for (const value of ['', 'invalid', 'one@example.invalid,', 'same@example.invalid,SAME@example.invalid', `${'a'.repeat(250)}@example.invalid`]) {
    assert.throws(() => loadConfig({ ...env, OIDC_INVITED_EMAILS: value }), error => {
      assert.ok(error instanceof ConfigurationError);
      if (value) assert.equal(error.message.includes(value), false);
      return true;
    });
  }
});

test('sandbox billing is all-or-nothing, immutable, managed-only and cannot accept live or unknown settings', () => {
  const env = {
    DATABASE_URL: 'postgres://localhost/synthetic_fixture', PUBLIC_ORIGIN: 'https://studio.fixture', COOKIE_SECURE: 'true',
    OIDC_ISSUER: 'https://broker.fixture/', OIDC_CLIENT_ID: 'synthetic-client', OIDC_CLIENT_SECRET: 'synthetic-secret',
    STRIPE_TEST_ACCOUNT_ID: 'acct_SyntheticFixture', STRIPE_TEST_SECRET_KEY: 'rk_test_SyntheticFixtureOnly',
    STRIPE_TEST_WEBHOOK_SECRET: 'whsec_SyntheticFixtureOnly',
  };
  const config = loadConfig(env);
  assert.ok(Object.isFrozen(config.billing));
  assert.equal(config.billing?.offers, null);
  assert.equal(config.billing?.accessPolicy, null);
  assert.equal(config.billing?.portalConfiguration, null);
  assert.equal(config.billing?.accountId, env.STRIPE_TEST_ACCOUNT_ID);
  for (const override of [
    { STRIPE_TEST_ACCOUNT_ID: undefined }, { STRIPE_TEST_ACCOUNT_ID: 'wrong' },
    { STRIPE_TEST_SECRET_KEY: undefined }, { STRIPE_TEST_SECRET_KEY: 'sk_live_SyntheticFixtureOnly' },
    { STRIPE_TEST_SECRET_KEY: 'rk_live_SyntheticFixtureOnly' },
    { STRIPE_TEST_WEBHOOK_SECRET: undefined }, { STRIPE_TEST_WEBHOOK_SECRET: 'unsafe secret' },
    { STRIPE_API_ORIGIN: 'https://foreign.fixture' }, { STRIPE_SECRET_KEY: 'unsupported' },
  ]) assert.throws(() => loadConfig({ ...env, ...override }), ConfigurationError);
  assert.throws(() => loadConfig({ STRIPE_TEST_ACCOUNT_ID: env.STRIPE_TEST_ACCOUNT_ID }), /requires managed identity/);
  env.STRIPE_TEST_ACCOUNT_ID = 'acct_ChangedFixture';
  assert.equal(config.billing?.accountId, 'acct_SyntheticFixture');
  const configured = loadConfig({ ...env, STRIPE_TEST_OFFERS: '{"pro_monthly":"price_SyntheticMonthly","pro_annual":"price_SyntheticAnnual"}' });
  assert.ok(Object.isFrozen(configured.billing?.offers));
  assert.equal(loadConfig({ ...env, STRIPE_TEST_ACCESS_POLICY: 'sandbox-card-service-v1' }).billing?.accessPolicy, 'sandbox-card-service-v1');
  assert.equal(loadConfig({ ...env, STRIPE_TEST_PORTAL_CONFIGURATION: 'bpc_SyntheticRestricted' }).billing?.portalConfiguration, 'bpc_SyntheticRestricted');
  for (const value of ['', 'bpc_', 'default', 'true', 'pmc_Foreign', 'bpc_With Space', 'https://billing.stripe.com/p/session']) {
    assert.throws(() => loadConfig({ ...env, STRIPE_TEST_PORTAL_CONFIGURATION: value }), ConfigurationError);
  }
  for (const policy of ['', 'true', 'pro-v1', 'live-card-service-v1', 'sandbox-card-service-v2']) {
    assert.throws(() => loadConfig({ ...env, STRIPE_TEST_ACCESS_POLICY: policy }), ConfigurationError);
  }
  for (const offers of ['{', '{}', '[]', '{"pro_monthly":"price_Same","pro_annual":"price_Same"}',
    '{"pro_monthly":"client-value","pro_annual":"price_Annual"}',
    '{"pro_monthly":"price_Monthly","pro_annual":"price_Annual","return_url":"https://foreign.fixture"}']) {
    assert.throws(() => loadConfig({ ...env, STRIPE_TEST_OFFERS: offers }), ConfigurationError);
  }
});
