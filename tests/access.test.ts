import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canUse, capabilities, type AccessView } from '../shared/access';
import { emptyState } from '../shared/domain';
import type { Bootstrap } from '../shared/types';

test('managed client decisions cannot fall back to demo plans and enforce exclusive deadlines', () => {
  const data: Bootstrap = { user: { id: 'owner', name: 'Fixture', email: '', demo: false }, state: { ...emptyState(), plan: 'lifetime' },
    capabilities: { ai: false, aiModel: null, commerce: 'disabled', community: 'read-only', fieldMetrics: false, auth: { mode: 'managed', system: 'authjs', providers: ['google', 'facebook'], legacyLink: false, securityLifecycle: false } } };
  assert.equal(canUse(data, 'mock.create', 1000), false);
  const access: AccessView = { authority: 'managed', state: 'pro', serverTime: new Date(1000).toISOString(), nextChangeAt: new Date(2000).toISOString(),
    features: capabilities.map(key => ({ key, allowed: key === 'mock.create', reason: 'granted', validUntil: new Date(2000).toISOString() })),
    sources: [], sourceHistoryTruncated: false };
  data.capabilities.access = access;
  assert.equal(canUse(data, 'mock.create', 1999), true);
  assert.equal(canUse(data, 'mock.create', 2000), false);
  assert.equal(canUse(data, 'project.create', 1999), false);
  assert.equal(canUse(data, 'ai.feedback.consume', 1999), false);
});

test('client access fails closed without server-verified access grants even when state contains a demo plan', () => {
  const data: Bootstrap = { user: { id: 'owner', name: 'Fixture', email: '', demo: false }, state: { ...emptyState(), plan: 'month', planExpiresAt: new Date(2000).toISOString() },
    capabilities: { ai: true, aiModel: 'gpt-6.1-sol', commerce: 'disabled', community: 'read-only', fieldMetrics: false } };
  assert.equal(canUse(data, 'project.create', 1999), false);
  assert.equal(canUse(data, 'archive.own.export', 1999), false);
  assert.equal(canUse(data, 'ai.feedback.consume', 1999), false);
});
