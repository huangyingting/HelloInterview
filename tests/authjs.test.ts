import assert from 'node:assert/strict';
import test from 'node:test';
import type { Account, Profile } from 'next-auth';
import { assertSocialAdmission, socialProof, type SocialProof } from '../server/auth/admission';
import { AuthConfigurationError, invitationHash, loadAuthSettings } from '../server/auth/config';

const secret = 'a'.repeat(64);
const environment = {
  NEXTAUTH_URL: 'https://interview.genisisiq.com',
  NEXTAUTH_SECRET: secret,
  AUTH_GOOGLE_CLIENT_ID: 'google-client',
  AUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
  AUTH_FACEBOOK_CLIENT_ID: '123456789',
  AUTH_FACEBOOK_CLIENT_SECRET: 'facebook-secret',
  AUTH_INVITED_EMAILS: 'invited@example.com,second@example.com',
};

test('Auth.js configuration is all-or-nothing, canonical and stores only invitation fingerprints', () => {
  assert.equal(loadAuthSettings({}), null);
  const config = loadAuthSettings(environment);
  assert.ok(config);
  assert.equal(config.origin, 'https://interview.genisisiq.com');
  assert.deepEqual(config.inviteEmailHashes, [
    invitationHash(secret, 'invited@example.com'),
    invitationHash(secret, 'second@example.com'),
  ]);
  assert.equal(JSON.stringify(config).includes('invited@example.com'), false);
  for (const [key, value] of Object.entries(environment)) {
    const malformed = { ...environment, [key]: undefined };
    assert.throws(() => loadAuthSettings(malformed), (error: unknown) => {
      assert.ok(error instanceof AuthConfigurationError);
      assert.equal(error.message.includes(value), false);
      return true;
    });
  }
});

test('social proofs trust Google verified-email evidence but never infer Facebook verification', () => {
  const google = socialProof(
    { provider: 'google', providerAccountId: 'subject', type: 'oauth' } as Account,
    { name: 'Invited Person', email: 'INVITED@example.com', email_verified: true } as Profile,
  );
  assert.deepEqual(google, {
    provider: 'google',
    issuer: 'https://accounts.google.com',
    subject: 'subject',
    name: 'Invited Person',
    email: 'invited@example.com',
    verifiedEmail: true,
  });
  const facebook = socialProof(
    { provider: 'facebook', providerAccountId: 'facebook-subject', type: 'oauth' } as Account,
    { name: 'Facebook Person', email: 'invited@example.com', email_verified: true } as Profile,
  );
  assert.equal(facebook.verifiedEmail, false);
});

test('new registration requires an invited verified Google identity and Facebook remains link-only', () => {
  const settings = loadAuthSettings(environment)!;
  const proof: SocialProof = {
    provider: 'google',
    issuer: 'https://accounts.google.com',
    subject: 'subject',
    name: 'Invited Person',
    email: 'invited@example.com',
    verifiedEmail: true,
  };
  assert.doesNotThrow(() => assertSocialAdmission(settings, proof, null));
  assert.throws(() => assertSocialAdmission(settings, { ...proof, email: 'other@example.com' }, null), /invitation/);
  assert.throws(() => assertSocialAdmission(settings, { ...proof, verifiedEmail: false }, null), /verified contact/);
  assert.throws(() => assertSocialAdmission(settings, {
    ...proof, provider: 'facebook', issuer: 'https://www.facebook.com', verifiedEmail: false,
  }, null), /first be linked/);
  assert.doesNotThrow(() => assertSocialAdmission(settings, {
    ...proof, provider: 'facebook', issuer: 'https://www.facebook.com', verifiedEmail: false,
  }, { id: 'identity', userId: 'owner', status: 'active' }));
  assert.throws(() => assertSocialAdmission(settings, proof, { id: 'identity', userId: 'owner', status: 'suspended' }), /not available/);
});
