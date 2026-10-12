import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { IdentityManagement } from '../server/identity/management';
import { HttpError } from '../server/http-error';

const settings = { origin: 'https://broker.fixture', clientId: 'synthetic-manager', clientSecret: 'synthetic-management-secret', hookSecret: '1'.repeat(64) };
const profile = { user_id: 'auth0|contract', updated_at: new Date(Date.now() - 10000).toISOString(), email: 'owner@example.invalid', email_verified: true };
const token = { access_token: 'synthetic-management-token', token_type: 'Bearer', expires_in: 3600, scope: 'read:users' };

test('read-only Management contract projects fields and rejects malformed, oversized, redirected and unavailable responses', async t => {
  const failures: { name: string; response: () => Response }[] = [
    { name: 'malformed JSON', response: () => new Response('{') },
    { name: 'malformed timestamp', response: () => Response.json({ ...profile, updated_at: 'not-a-date' }) },
    { name: 'wrong subject', response: () => Response.json({ ...profile, user_id: 'auth0|foreign' }) },
    { name: 'future cutoff', response: () => Response.json({ ...profile, last_password_reset: new Date(Date.now() + 60000).toISOString() }) },
    { name: 'oversized body', response: () => Response.json({ ...profile, unexpected: 'x'.repeat(17000) }) },
    { name: 'forbidden', response: () => new Response(null, { status: 403 }) },
    { name: 'rate limited', response: () => new Response(null, { status: 429 }) },
    { name: 'server outage', response: () => new Response(null, { status: 503 }) },
    { name: 'redirect', response: () => new Response(null, { status: 302, headers: { Location: 'https://foreign.fixture/' } }) },
    { name: 'failed body stream', response: () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('synthetic stream failure')); } })) },
  ];
  for (const failure of failures) await t.test(failure.name, async () => {
    const management = new IdentityManagement(settings, new AbortController().signal, async (url, options) => {
      assert.equal(new URL(url).origin, settings.origin);
      assert.equal(options.redirect, 'manual');
      if (url.endsWith('/oauth/token')) return Response.json(token);
      const query = new URL(url).searchParams;
      assert.equal(query.get('include_fields'), 'true');
      assert.equal(query.get('fields'), 'user_id,updated_at,last_password_reset,blocked,email,email_verified');
      return failure.response();
    });
    await assert.rejects(management.facts(profile.user_id), error => error instanceof HttpError && error.status === 502);
  });
  const management = new IdentityManagement(settings, new AbortController().signal, async url =>
    url.endsWith('/oauth/token') ? Response.json(token) : new Response(null, { status: 404 }));
  assert.equal((await management.facts(profile.user_id)).disabled, 2);
});

type PasswordEvent = { secrets: Record<string, string>; user: { user_id: string } };
async function action(fetch: typeof globalThis.fetch) {
  const exports: { onExecutePostChangePassword?: (event: PasswordEvent) => Promise<void> } = {};
  runInNewContext(await readFile('server/identity/auth0-password-action.cjs', 'utf8'), {
    exports, URL, Buffer, AbortSignal, fetch,
    require(name: string) { assert.equal(name, 'node:crypto'); return { createHmac, randomUUID }; },
  });
  assert.ok(exports.onExecutePostChangePassword);
  return exports.onExecutePostChangePassword;
}
const event: PasswordEvent = { secrets: {
  STUDIO_OIDC_ISSUER: `${settings.origin}/`,
  STUDIO_PASSWORD_EVENT_URL: 'https://studio.fixture/webhooks/identity/password-change',
  STUDIO_PASSWORD_HOOK_SECRET: settings.hookSecret,
}, user: { user_id: profile.user_id } };

test('reference password Action signs exact minimal bytes and requires a valid application acknowledgement', async () => {
  let delivered = 0;
  const run = await action(async (url, options) => {
    delivered++;
    assert.equal(String(url), event.secrets.STUDIO_PASSWORD_EVENT_URL);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    assert.equal(typeof options?.body, 'string');
    const body = String(options?.body), headers = new Headers(options?.headers), timestamp = headers.get('X-Studio-Timestamp');
    assert.ok(timestamp);
    assert.equal(headers.get('X-Studio-Signature'), createHmac('sha256', Buffer.from(settings.hookSecret, 'hex')).update(`${timestamp}.${body}`).digest('hex'));
    const payload = JSON.parse(body);
    assert.deepEqual(Object.keys(payload).sort(), ['eventId', 'issuer', 'kind', 'occurredAt', 'subject', 'version']);
    assert.equal(payload.subject, profile.user_id);
    assert.equal(payload.issuer, `${settings.origin}/`);
    assert.ok(Math.abs(Date.now() - payload.occurredAt) < 5000);
    return Response.json({ accepted: true, duplicate: false });
  });
  await run(event);
  assert.equal(delivered, 1);
  for (const acknowledgement of [{ accepted: false, duplicate: false }, { accepted: true, duplicate: 'invalid' }]) {
    await assert.rejects((await action(async () => Response.json(acknowledgement)))(event), /invalid.*acknowledgement/);
  }
  await assert.rejects((await action(async () => new Response(null, { status: 503 })))(event), /did not acknowledge/);
});

test('reference Action refuses foreign paths, noncanonical issuers and social-password claims before delivery', async () => {
  const run = await action(async () => { assert.fail('Invalid Action configuration must not send an event.'); });
  for (const secrets of [
    { ...event.secrets, STUDIO_PASSWORD_EVENT_URL: 'https://studio.fixture/api/profile' },
    { ...event.secrets, STUDIO_OIDC_ISSUER: 'https://broker.fixture/wrong-issuer/' },
    { ...event.secrets, STUDIO_OIDC_ISSUER: 'http://broker.fixture/' },
    { ...event.secrets, STUDIO_PASSWORD_HOOK_SECRET: 'invalid-key' },
  ]) await assert.rejects(run({ ...event, secrets }), /configuration is invalid/);
  await assert.rejects(run({ ...event, user: { user_id: 'github|upstream-password' } }), /configuration is invalid/);
});
