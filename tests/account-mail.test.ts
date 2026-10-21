import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAccountMailSender } from '../server/account-admission/mail-config';
import { deliverAccountEmail } from '../server/account-admission/worker';

const config = { apiKey: 're_test_fixture_only', from: 'Studio <noreply@example.test>' };
const message = { id: 'outbox-fixture', claimToken: 'lease-fixture', kind: 'invitation' as const,
  to: 'invited@example.test', subject: 'Invitation', text: 'Private invitation link', html: '<p>Private invitation link</p>' };

test('account mail is optional but an enabled sender requires real configuration', () => {
  assert.equal(loadAccountMailSender({}), null);
  assert.equal(loadAccountMailSender({ ACCOUNT_MAIL_WORKFLOW_ENABLED: 'false' }), null);
  assert.throws(() => loadAccountMailSender({ ACCOUNT_MAIL_WORKFLOW_ENABLED: 'true' }), /RESEND_API_KEY/);
  assert.throws(() => loadAccountMailSender({ ACCOUNT_MAIL_WORKFLOW_ENABLED: 'yes' }), /ACCOUNT_MAIL_WORKFLOW_ENABLED/);
  assert.throws(() => loadAccountMailSender({ ACCOUNT_MAIL_WORKFLOW_ENABLED: 'true', RESEND_API_KEY: config.apiKey, ACCOUNT_MAIL_FROM: 'invalid' }), /ACCOUNT_MAIL_FROM/);
  assert.deepEqual(loadAccountMailSender({ ACCOUNT_MAIL_WORKFLOW_ENABLED: 'true', RESEND_API_KEY: config.apiKey, ACCOUNT_MAIL_FROM: config.from }), config);
});

test('sender uses a fixed provider, idempotency identity, bounded request and a genuine acceptance receipt', async () => {
  const sent = await deliverAccountEmail(message, config, async (url, request) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(new Headers(request?.headers).get('Idempotency-Key'), message.id);
    assert.ok(request?.signal);
    assert.equal(request?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(request?.body)), { from: config.from, to: [message.to], subject: message.subject, text: message.text, html: message.html });
    return Response.json({ id: 'provider-receipt' });
  });
  assert.deepEqual(sent, { status: 'sent' });
});

test('provider rejection, transport ambiguity and malformed acknowledgements never claim delivery', async () => {
  assert.equal((await deliverAccountEmail(message, config, async () => new Response(null, { status: 422 }))).status, 'failed');
  assert.equal((await deliverAccountEmail(message, config, async () => new Response(null, { status: 500 }))).status, 'unconfirmed');
  assert.equal((await deliverAccountEmail(message, config, async () => { throw new Error('timeout'); })).status, 'unconfirmed');
  assert.equal((await deliverAccountEmail(message, config, async () => Response.json({}))).status, 'unconfirmed');
  assert.equal((await deliverAccountEmail(message, config, async () => new Response('invalid json'))).status, 'unconfirmed');
});
