import { isIP } from 'node:net';
import path from 'node:path';

export interface IdentityConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly connections: Readonly<{ email: string; google: string; github: string }>;
  readonly legacyLinkUntil: number | null;
  readonly lifecycle: Readonly<{ origin: string; clientId: string; clientSecret: string; hookSecret: string }> | null;
}
export interface ServerConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly appMode: 'local' | 'service';
  readonly rootDir: string;
  readonly frontendDir: string;
  readonly dataDir: string;
  readonly databaseUrl: string | null;
  readonly publicOrigin: string | null;
  readonly trustedProxies: readonly string[];
  readonly logRequests: boolean;
  readonly host: string;
  readonly port: number;
  readonly cookieSecure: boolean;
  readonly ai: Readonly<{ apiKey: string; baseUrl: string; model: string }> | null;
  readonly identity: Readonly<IdentityConfig> | null;
}

export class ConfigurationError extends Error {
  constructor(setting: string, requirement: string) {
    super(`${setting} ${requirement}`);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, rootDir = process.cwd()): ServerConfig {
  const environment = env.NODE_ENV ?? 'development';
  if (environment !== 'development' && environment !== 'test' && environment !== 'production') {
    throw new ConfigurationError('NODE_ENV', 'must be development, test, or production.');
  }
  const appMode = env.APP_MODE ?? 'local';
  if (appMode !== 'local' && appMode !== 'service') throw new ConfigurationError('APP_MODE', 'must be local or service.');
  if (appMode === 'service') throw new ConfigurationError('APP_MODE', 'service mode is not enabled in this release; managed identity lifecycle and production authorization are still pending.');
  const portText = env.PORT ?? '3000';
  if (!/^\d+$/.test(portText) || !Number.isSafeInteger(Number(portText)) || Number(portText) > 65535) {
    throw new ConfigurationError('PORT', 'must be an integer between 0 and 65535.');
  }
  const host = env.HOST ?? '127.0.0.1';
  const validHostname = host.length <= 253 && !/^[\d.]+$/.test(host) && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  if (!isIP(host) && !validHostname) throw new ConfigurationError('HOST', 'must be an IP address or hostname, without a port or URL.');
  const cookieSecure = env.COOKIE_SECURE ?? 'false';
  if (cookieSecure !== 'true' && cookieSecure !== 'false') {
    throw new ConfigurationError('COOKIE_SECURE', 'must be true or false.');
  }
  const logRequests = env.LOG_REQUESTS ?? (environment === 'production' ? 'true' : 'false');
  if (!['true', 'false'].includes(logRequests)) throw new ConfigurationError('LOG_REQUESTS', 'must be true or false.');
  let publicOrigin: string | null = null;
  if (env.PUBLIC_ORIGIN !== undefined) {
    try {
      const url = new URL(env.PUBLIC_ORIGIN);
      if (/[\x00-\x20\x7f]/.test(env.PUBLIC_ORIGIN) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || env.PUBLIC_ORIGIN.includes('?') || env.PUBLIC_ORIGIN.includes('#')) throw new Error('Invalid public origin.');
      publicOrigin = url.origin;
    } catch {
      throw new ConfigurationError('PUBLIC_ORIGIN', 'must be an HTTP or HTTPS origin without credentials, a path, query, or fragment.');
    }
    if (cookieSecure === 'true' && !publicOrigin.startsWith('https://')) throw new ConfigurationError('PUBLIC_ORIGIN', 'must use HTTPS when COOKIE_SECURE is true.');
    if (publicOrigin.startsWith('https://') && cookieSecure !== 'true') throw new ConfigurationError('COOKIE_SECURE', 'must be true when PUBLIC_ORIGIN uses HTTPS.');
  }
  const trustedProxies = env.TRUST_PROXY === undefined ? [] : env.TRUST_PROXY.split(',').map(value => value.trim());
  for (const proxy of trustedProxies) {
    const [address, prefix, extra] = proxy.split('/');
    const family = isIP(address);
    if (!family || extra !== undefined || prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128))) throw new ConfigurationError('TRUST_PROXY', 'must be a comma-separated allowlist of proxy IP addresses or non-global CIDR networks, not a boolean or hop count.');
  }
  const dataDir = env.DATA_DIR ?? 'data';
  if (!dataDir.trim() || dataDir.includes('\0')) throw new ConfigurationError('DATA_DIR', 'must be a nonempty filesystem path.');
  const databaseUrl = env.DATABASE_URL ?? null;
  if (databaseUrl !== null) {
    try {
      if (/[\x00-\x20\x7f]/.test(databaseUrl)) throw new Error('Invalid URL characters.');
      const url = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) throw new Error('Invalid PostgreSQL URL.');
    } catch {
      throw new ConfigurationError('DATABASE_URL', 'must be a PostgreSQL connection URL with a hostname and database name.');
    }
  }
  const apiKey = env.OPENAI_API_KEY?.trim() || null;
  if (apiKey && /[\x00-\x20\x7f]/.test(apiKey)) throw new ConfigurationError('OPENAI_API_KEY', 'must not contain whitespace or control characters.');
  const baseUrlText = env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  let baseUrl: URL;
  try {
    if (/[\x00-\x20\x7f]/.test(baseUrlText)) throw new Error('Invalid URL characters.');
    baseUrl = new URL(baseUrlText);
  } catch {
    throw new ConfigurationError('OPENAI_BASE_URL', 'must be an absolute HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrlText.includes('?') || baseUrlText.includes('#')) {
    throw new ConfigurationError('OPENAI_BASE_URL', 'must be HTTP or HTTPS without credentials, a query, or a fragment.');
  }
  const model = env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
  if (model.length > 200 || /[\x00-\x20\x7f]/.test(model)) throw new ConfigurationError('OPENAI_MODEL', 'must be a model identifier of at most 200 characters.');
  let identity: Readonly<IdentityConfig> | null = null;
  const identitySettings = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_EMAIL_CONNECTION', 'OIDC_GOOGLE_CONNECTION', 'OIDC_GITHUB_CONNECTION', 'OIDC_LEGACY_LINK_UNTIL',
    'OIDC_MANAGEMENT_ORIGIN', 'OIDC_MANAGEMENT_CLIENT_ID', 'OIDC_MANAGEMENT_CLIENT_SECRET', 'OIDC_PASSWORD_HOOK_SECRET'];
  const providedIdentitySettings = Object.keys(env).filter(key => key.startsWith('OIDC_') && env[key] !== undefined);
  if (providedIdentitySettings.length) {
    if (providedIdentitySettings.some(key => !identitySettings.includes(key))) throw new ConfigurationError('OIDC configuration', 'contains an unsupported setting.');
    let issuer: URL;
    try {
      const value = env.OIDC_ISSUER;
      if (!value || /[\x00-\x20\x7f]/.test(value)) throw new Error('Invalid issuer.');
      issuer = new URL(value);
      if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.pathname !== '/' || issuer.search || issuer.hash || value.includes('?') || value.includes('#')) throw new Error('Invalid issuer.');
    } catch { throw new ConfigurationError('OIDC_ISSUER', 'must be an HTTPS broker origin without credentials, a path, query or fragment.'); }
    const clientId = env.OIDC_CLIENT_ID;
    if (!clientId || !/^[A-Za-z0-9_-]{1,200}$/.test(clientId)) throw new ConfigurationError('OIDC_CLIENT_ID', 'must be a bounded broker client identifier.');
    const clientSecret = env.OIDC_CLIENT_SECRET;
    if (!clientSecret || clientSecret.length < 8 || clientSecret.length > 4096 || /[\x00-\x20\x7f]/.test(clientSecret)) throw new ConfigurationError('OIDC_CLIENT_SECRET', 'must be a nonempty confidential-client secret without whitespace.');
    if (!databaseUrl) throw new ConfigurationError('DATABASE_URL', 'is required for managed identity.');
    if (!publicOrigin?.startsWith('https://') || cookieSecure !== 'true') throw new ConfigurationError('PUBLIC_ORIGIN', 'and COOKIE_SECURE must enable a canonical HTTPS origin for managed identity.');
    const connections = {
      email: env.OIDC_EMAIL_CONNECTION ?? 'Username-Password-Authentication',
      google: env.OIDC_GOOGLE_CONNECTION ?? 'google-oauth2',
      github: env.OIDC_GITHUB_CONNECTION ?? 'github',
    };
    for (const [provider, value] of Object.entries(connections)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new ConfigurationError(`OIDC_${provider.toUpperCase()}_CONNECTION`, 'must be a bounded broker connection identifier.');
    }
    let legacyLinkUntil: number | null = null;
    if (env.OIDC_LEGACY_LINK_UNTIL !== undefined) {
      legacyLinkUntil = Date.parse(env.OIDC_LEGACY_LINK_UNTIL);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(env.OIDC_LEGACY_LINK_UNTIL) || !Number.isFinite(legacyLinkUntil) || legacyLinkUntil <= Date.now() || legacyLinkUntil > Date.now() + 30 * 86400000) {
        throw new ConfigurationError('OIDC_LEGACY_LINK_UNTIL', 'must be an explicit future UTC deadline within 30 days.');
      }
    }
    let lifecycle: IdentityConfig['lifecycle'] = null;
    if (['OIDC_MANAGEMENT_ORIGIN', 'OIDC_MANAGEMENT_CLIENT_ID', 'OIDC_MANAGEMENT_CLIENT_SECRET', 'OIDC_PASSWORD_HOOK_SECRET'].some(key => env[key] !== undefined)) {
      let managementOrigin: URL;
      try {
        const value = env.OIDC_MANAGEMENT_ORIGIN;
        if (!value || /[\x00-\x20\x7f]/.test(value)) throw new Error('Invalid origin.');
        managementOrigin = new URL(value);
        if (managementOrigin.protocol !== 'https:' || managementOrigin.username || managementOrigin.password || managementOrigin.pathname !== '/' ||
          managementOrigin.search || managementOrigin.hash || value.includes('?') || value.includes('#')) throw new Error('Invalid origin.');
      } catch { throw new ConfigurationError('OIDC_MANAGEMENT_ORIGIN', 'must be the explicit HTTPS tenant Management API origin.'); }
      const managementId = env.OIDC_MANAGEMENT_CLIENT_ID, managementSecret = env.OIDC_MANAGEMENT_CLIENT_SECRET, hookSecret = env.OIDC_PASSWORD_HOOK_SECRET;
      if (!managementId || !/^[A-Za-z0-9_-]{1,200}$/.test(managementId) || managementId === clientId) throw new ConfigurationError('OIDC_MANAGEMENT_CLIENT_ID', 'must identify a separate read-only machine client.');
      if (!managementSecret || managementSecret.length < 8 || managementSecret.length > 4096 || /[\x00-\x20\x7f]/.test(managementSecret)) throw new ConfigurationError('OIDC_MANAGEMENT_CLIENT_SECRET', 'must be a confidential machine-client secret.');
      if (!hookSecret || !/^[a-f0-9]{64}$/.test(hookSecret)) throw new ConfigurationError('OIDC_PASSWORD_HOOK_SECRET', 'must be a private 32-byte hexadecimal signing key.');
      lifecycle = Object.freeze({ origin: managementOrigin.origin, clientId: managementId, clientSecret: managementSecret, hookSecret });
    }
    identity = Object.freeze({ issuer: `${issuer.origin}/`, clientId, clientSecret, connections: Object.freeze(connections), legacyLinkUntil, lifecycle });
  }
  const root = path.resolve(rootDir);
  return Object.freeze({
    environment,
    appMode,
    rootDir: root,
    frontendDir: path.join(root, 'dist'),
    dataDir: path.resolve(root, dataDir),
    databaseUrl,
    publicOrigin,
    trustedProxies: Object.freeze(trustedProxies),
    logRequests: logRequests === 'true',
    host,
    port: Number(portText),
    cookieSecure: cookieSecure === 'true',
    ai: apiKey ? Object.freeze({ apiKey, baseUrl: baseUrl.href.replace(/\/+$/, ''), model }) : null,
    identity,
  });
}
