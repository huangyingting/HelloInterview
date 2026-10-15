import type { Bootstrap } from './types';

export const capabilities = [
  'preparation.free.write', 'archive.own.read', 'archive.own.export',
  'content.premium.read', 'learning.premium.write', 'practice.premium.create',
  'mock.create', 'quiz.custom.create', 'plan.create', 'project.create', 'tutor.premium.use', 'ai.feedback.consume',
] as const;
export type Capability = typeof capabilities[number];
export const proCapabilities: readonly Capability[] = [
  'content.premium.read', 'learning.premium.write', 'practice.premium.create',
  'mock.create', 'quiz.custom.create', 'plan.create', 'project.create', 'tutor.premium.use',
];
export type AccessReason = 'free' | 'granted' | 'no-grant' | 'expired' | 'revoked' | 'scheduled' | 'restricted' | 'unavailable' | 'anonymous';
export interface AccessView {
  authority: 'managed';
  state: 'visitor' | 'restricted' | 'free' | 'read-only' | 'pro';
  serverTime: string;
  nextChangeAt: string | null;
  features: { key: Capability; allowed: boolean; reason: AccessReason; validUntil: string | null }[];
  sources: { id: string; kind: 'billing' | 'support' | 'promotion' | 'engineering'; policy: 'pro-v1' | 'premium-read-v1'; startsAt: string; endsAt: string; revoked: boolean }[];
  sourceHistoryTruncated: boolean;
}
export function canUse(data: Bootstrap, capability: Capability, now = Date.now()): boolean {
  const access = data.capabilities.access;
  const feature = access?.features.find(feature => feature.key === capability);
  return !!feature?.allowed && (!feature.validUntil || Date.parse(feature.validUntil) > now);
}
