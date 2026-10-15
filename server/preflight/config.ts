import { isIP } from 'node:net';
import { loadManagedAiConfig, type ManagedAiConfig } from '../ai/config';
import { loadAuthSettings, type AuthSettings } from '../auth/config';
import { loadBillingConfig, type BillingConfig } from '../billing/config';
import { loadParticipantPolicy } from '../participant-policy';
import type { ParticipantPolicy } from '../../shared/types';

export class ServicePreflightConfigurationError extends Error {
  constructor(setting: string, requirement: string) {
    super(`${setting} ${requirement}`);
    this.name = 'ServicePreflightConfigurationError';
  }
}

export interface ServicePreflightConfig {
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly trustedProxies: readonly string[];
  readonly auth: Readonly<AuthSettings>;
  readonly participantPolicy: Readonly<ParticipantPolicy>;
  readonly ai: Readonly<ManagedAiConfig> | null;
  readonly billing: Readonly<BillingConfig> | null;
}

function fail(setting: string, requirement: string): never {
  throw new ServicePreflightConfigurationError(setting, requirement);
}

export function loadServicePreflightConfig(env: Readonly<Record<string, string | undefined>> = process.env): Readonly<ServicePreflightConfig> {
  if (env.NODE_ENV !== 'production') fail('NODE_ENV', 'must be production for the operated service.');
  const portText = env.PORT ?? '3000';
  if (!/^\d+$/.test(portText) || !Number.isSafeInteger(Number(portText)) || Number(portText) > 65535) {
    fail('PORT', 'must be an integer between 0 and 65535.');
  }
  const host = env.HOSTNAME ?? '127.0.0.1';
  const validHostname = host.length <= 253 && !/^[\d.]+$/.test(host)
    && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  if (!isIP(host) && !validHostname) fail('HOSTNAME', 'must be an IP address or hostname, without a port or URL.');
  const databaseUrl = env.DATABASE_URL;
  try {
    if (!databaseUrl || /[\x00-\x20\x7f]/.test(databaseUrl)) throw new Error('Invalid URL.');
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) {
      throw new Error('Invalid PostgreSQL URL.');
    }
  } catch {
    fail('DATABASE_URL', 'must be a PostgreSQL connection URL with a hostname and database name.');
  }
  const trustedProxies = env.TRUST_PROXY?.split(',').map(value => value.trim()) ?? [];
  if (!trustedProxies.length) fail('TRUST_PROXY', 'must identify the private HTTPS ingress.');
  for (const proxy of trustedProxies) {
    const [address, prefix, extra] = proxy.split('/');
    const family = isIP(address);
    if (!family || extra !== undefined || prefix !== undefined
      && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128))) {
      fail('TRUST_PROXY', 'must be a comma-separated allowlist of proxy IP addresses or CIDR networks.');
    }
  }
  const auth = loadAuthSettings(env);
  if (!auth) fail('Auth.js configuration', 'is required for the operated service.');
  const participantPolicy = loadParticipantPolicy(env, fail);
  if (!participantPolicy) fail('Participant policy', 'is required for the operated service.');
  const ai = loadManagedAiConfig(env);
  const billing = loadBillingConfig(env, {
    identity: true,
    databaseUrl,
    publicOrigin: auth!.origin,
  }, fail);
  return Object.freeze({
    databaseUrl: databaseUrl!,
    host,
    port: Number(portText),
    trustedProxies: Object.freeze(trustedProxies),
    auth: auth!,
    participantPolicy,
    ai,
    billing,
  });
}
