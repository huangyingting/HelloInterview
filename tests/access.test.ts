import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canUse, capabilities, type AccessView } from '../shared/access';
import { emptyState } from '../shared/domain';
import type { Bootstrap } from '../shared/types';

test('managed client decisions cannot fall back to demo plans and enforce exclusive deadlines', () => {
  const data: Bootstrap = { user: { id: 'owner', name: 'Fixture', email: '', demo: false }, state: { ...emptyState(), plan: 'lifetime' },
    capabilities: { ai: false, aiModel: null, commerce: 'disabled', community: 'read-only', auth: { mode: 'managed', providers: ['email'], legacyLink: false, securityLifecycle: false } } };
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

test('local client access retains demo policy and does not invent external AI availability', () => {
  const data: Bootstrap = { user: { id: 'local', name: 'Fixture', email: '', demo: true }, state: { ...emptyState(), plan: 'month', planExpiresAt: new Date(2000).toISOString() },
    capabilities: { ai: false, aiModel: null, commerce: 'demo', community: 'local' } };
  assert.equal(canUse(data, 'project.create', 1999), true);
  assert.equal(canUse(data, 'project.create', 2000), false);
  assert.equal(canUse(data, 'archive.own.export', 2000), true);
  assert.equal(canUse(data, 'ai.feedback.consume', 1999), false);
});
