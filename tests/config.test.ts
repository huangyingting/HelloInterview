import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { ConfigurationError, loadConfig } from '../server/config';

test('configuration defaults preserve loopback, local data, cookies and optional AI', () => {
  const config = loadConfig({}, '/tmp/studio-config-fixture');
  assert.deepEqual(config, {
    environment: 'development',
    rootDir: '/tmp/studio-config-fixture',
    frontendDir: '/tmp/studio-config-fixture/dist',
    dataDir: '/tmp/studio-config-fixture/data',
    host: '127.0.0.1',
    port: 3000,
    cookieSecure: false,
    ai: null,
  });
});

test('configuration resolves paths and accepts explicit runtime settings and IPv6', () => {
  const config = loadConfig({ NODE_ENV: 'production', HOST: '::1', PORT: '0', COOKIE_SECURE: 'true', DATA_DIR: 'private-data' });
  assert.equal(config.environment, 'production');
  assert.equal(config.host, '::1');
  assert.equal(config.port, 0);
  assert.equal(config.cookieSecure, true);
  assert.equal(config.dataDir, path.resolve('private-data'));
  assert.equal(loadConfig({ DATA_DIR: '/tmp/studio-absolute-data' }).dataDir, '/tmp/studio-absolute-data');
  assert.equal(loadConfig({ HOST: 'localhost', PORT: '65535' }).port, 65535);
  assert.equal(loadConfig({ HOST: 'studio.internal' }).host, 'studio.internal');
});

test('optional AI configuration normalizes the endpoint without leaking it to client capabilities', () => {
  assert.equal(loadConfig({ OPENAI_API_KEY: '', OPENAI_BASE_URL: '', OPENAI_MODEL: '' }).ai, null);
  assert.deepEqual(loadConfig({ OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1///', OPENAI_MODEL: 'fixture-model' }).ai, {
    apiKey: 'fixture-only',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'fixture-model',
  });
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

test('invalid settings fail explicitly without putting their values in the error message', () => {
  const invalid: [string, string[]][] = [
    ['NODE_ENV', ['', 'prod', 'staging']],
    ['PORT', ['', '-1', '65536', '1.5', '1e3', 'NaN', 'Infinity', '3000oops', ' 3000', '9007199254740993']],
    ['HOST', ['', 'https://example.com', 'localhost:3000', '[::1]', '127.0.0.999', '-bad-host', 'bad host', 'host/path']],
    ['COOKIE_SECURE', ['', '1', 'yes', 'TRUE', 'false ']],
    ['DATA_DIR', ['', '   ', 'data\0invalid']],
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
