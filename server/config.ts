import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { z } from 'zod';
import type { ParticipantPolicy } from '../shared/types';
import { loadBillingConfig, type BillingConfig } from './billing/config';

export type { BillingConfig } from './billing/config';

export const privateBetaDurabilityNotice = 'This invite-only private beta has no backup, recovery point objective, or recovery time objective. Saved data may be lost, so participants must keep another copy of important information.';

export interface IdentityConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly connections: Readonly<{ email: string; google: string; github: string }>;
  readonly inviteEmailHashes: readonly string[] | null;
  readonly legacyLinkUntil: number | null;
  readonly lifecycle: Readonly<{ origin: string; clientId: string; clientSecret: string; hookSecret: string }> | null;
}
export interface ServerConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly appMode: 'local' | 'service';
  readonly rootDir: string;
  readonly frontendDir: string;
  readonly retainedFrontendDirs: readonly string[];
  readonly dataDir: string;
  readonly databaseUrl: string | null;
  readonly publicOrigin: string | null;
  readonly trustedProxies: readonly string[];
  readonly logRequests: boolean;
  readonly fieldMetrics: boolean;
  readonly participantPolicy: Readonly<ParticipantPolicy> | null;
  readonly host: string;
  readonly port: number;
  readonly cookieSecure: boolean;
  readonly ai: Readonly<{ provider:'openai'|'azure-openai';apiKey:string;baseUrl:string;model:string;apiVersion:string|null }> | null;
  readonly identity: Readonly<IdentityConfig> | null;
  readonly billing: Readonly<BillingConfig> | null;
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
  const fieldMetrics = env.FIELD_METRICS_ENABLED ?? 'false';
  if (!['true', 'false'].includes(fieldMetrics)) throw new ConfigurationError('FIELD_METRICS_ENABLED', 'must be true or false.');
  const participantSettings = ['PRIVACY_CONTROLLER_NAME', 'PRIVACY_CONTACT_URL', 'PARTICIPANT_MINIMUM_AGE',
    'PRIVACY_RETENTION_NOTICE', 'PRIVACY_DELETION_NOTICE', 'PRIVATE_BETA_NO_DURABILITY_ACK'];
  let participantPolicy: Readonly<ParticipantPolicy> | null = null;
  if (participantSettings.some(key => env[key] !== undefined)) {
    const statement = (key: string, minimum: number, maximum: number) => {
      const value = env[key]?.trim();
      if (!value || value.length < minimum || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) {
        throw new ConfigurationError(key, `must be plain public text of ${minimum} to ${maximum} characters.`);
      }
      return value;
    };
    const controllerName = statement('PRIVACY_CONTROLLER_NAME', 2, 200);
    const contactText = env.PRIVACY_CONTACT_URL?.trim();
    let contactUrl: URL;
    try {
      if (!contactText || contactText.length > 2048 || /[\x00-\x20\x7f]/.test(contactText)) throw new Error('Invalid contact.');
      contactUrl = new URL(contactText);
      const email = contactUrl.protocol === 'mailto:' && !contactUrl.search && !contactUrl.hash &&
        z.string().email().max(254).safeParse(contactUrl.pathname).success;
      const web = contactUrl.protocol === 'https:' && !contactUrl.username && !contactUrl.password;
      if (!email && !web) throw new Error('Invalid contact.');
    } catch {
      throw new ConfigurationError('PRIVACY_CONTACT_URL', 'must be a public HTTPS or mailto contact without credentials.');
    }
    const ageText = env.PARTICIPANT_MINIMUM_AGE;
    if (!ageText || !/^\d{2,3}$/.test(ageText) || Number(ageText) < 13 || Number(ageText) > 120) {
      throw new ConfigurationError('PARTICIPANT_MINIMUM_AGE', 'must be an integer from 13 through 120.');
    }
    if (env.PRIVATE_BETA_NO_DURABILITY_ACK !== 'true') {
      throw new ConfigurationError('PRIVATE_BETA_NO_DURABILITY_ACK', 'must explicitly acknowledge the approved no-backup and no-RPO/RTO boundary.');
    }
    participantPolicy = Object.freeze({
      controllerName,
      contactUrl: contactUrl.href,
      minimumAge: Number(ageText),
      retentionNotice: statement('PRIVACY_RETENTION_NOTICE', 20, 1000),
      deletionNotice: statement('PRIVACY_DELETION_NOTICE', 20, 1000),
      durabilityNotice: privateBetaDurabilityNotice,
    });
  }
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
  const azureSettings=['AZURE_OPENAI_API_KEY','AZURE_OPENAI_ENDPOINT','AZURE_OPENAI_DEPLOYMENT','AZURE_OPENAI_API_VERSION'];
  const hasAzure=azureSettings.some(key=>env[key]!==undefined);
  const hasOpenAi=['OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL'].some(key=>env[key]!==undefined);
  if(hasAzure&&hasOpenAi)throw new ConfigurationError('AI configuration','must select either OPENAI_* or AZURE_OPENAI_* settings, not both.');
  let ai:ServerConfig['ai']=null;
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
  if(apiKey)ai=Object.freeze({provider:'openai' as const,apiKey,baseUrl:baseUrl.href.replace(/\/+$/,''),model,apiVersion:null});
  if(hasAzure){
    const key=env.AZURE_OPENAI_API_KEY?.trim(),deployment=env.AZURE_OPENAI_DEPLOYMENT?.trim(),version=env.AZURE_OPENAI_API_VERSION?.trim(),endpointText=env.AZURE_OPENAI_ENDPOINT?.trim();
    if(!key||/[\x00-\x20\x7f]/.test(key))throw new ConfigurationError('AZURE_OPENAI_API_KEY','must be present without whitespace or control characters.');
    if(!deployment||deployment.length>200||!/^[A-Za-z0-9._-]+$/.test(deployment))throw new ConfigurationError('AZURE_OPENAI_DEPLOYMENT','must be a bounded deployment identifier.');
    if(!version||!/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(version))throw new ConfigurationError('AZURE_OPENAI_API_VERSION','must be a dated Azure OpenAI API version.');
    let endpoint:URL;
    try{endpoint=new URL(endpointText??'');}catch{throw new ConfigurationError('AZURE_OPENAI_ENDPOINT','must be an HTTPS origin or loopback HTTP origin.');}
    const loopback=endpoint.protocol==='http:'&&['127.0.0.1','::1','localhost'].includes(endpoint.hostname);
    if(!(endpoint.protocol==='https:'||loopback)||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new ConfigurationError('AZURE_OPENAI_ENDPOINT','must be an HTTPS origin or loopback HTTP origin.');
    ai=Object.freeze({provider:'azure-openai' as const,apiKey:key,baseUrl:`${endpoint.origin}/openai/deployments/${encodeURIComponent(deployment)}`,model:deployment,apiVersion:version});
  }
  let identity: Readonly<IdentityConfig> | null = null;
  const identitySettings = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_EMAIL_CONNECTION', 'OIDC_GOOGLE_CONNECTION', 'OIDC_GITHUB_CONNECTION', 'OIDC_LEGACY_LINK_UNTIL',
    'OIDC_MANAGEMENT_ORIGIN', 'OIDC_MANAGEMENT_CLIENT_ID', 'OIDC_MANAGEMENT_CLIENT_SECRET', 'OIDC_PASSWORD_HOOK_SECRET', 'OIDC_INVITED_EMAILS'];
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
    let inviteEmailHashes: readonly string[] | null = null;
    if (env.OIDC_INVITED_EMAILS !== undefined) {
      if (env.OIDC_INVITED_EMAILS.length > 65536) throw new ConfigurationError('OIDC_INVITED_EMAILS', 'must contain at most 200 bounded email addresses.');
      const emails = env.OIDC_INVITED_EMAILS.split(',').map(value => value.trim().toLowerCase());
      if (emails.length > 200 || emails.some(value => !z.string().email().max(254).safeParse(value).success) || new Set(emails).size !== emails.length) {
        throw new ConfigurationError('OIDC_INVITED_EMAILS', 'must contain 1 to 200 distinct comma-separated email addresses.');
      }
      inviteEmailHashes = Object.freeze(emails.map(value => createHmac('sha256', clientSecret).update(value).digest('hex')));
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
    identity = Object.freeze({ issuer: `${issuer.origin}/`, clientId, clientSecret, connections: Object.freeze(connections), inviteEmailHashes, legacyLinkUntil, lifecycle });
  }
  const billing = loadBillingConfig(env, { identity: !!identity, databaseUrl, publicOrigin },
    (setting, requirement) => { throw new ConfigurationError(setting, requirement); });
  const root = path.resolve(rootDir);
  const frontendDir = path.join(root, 'dist');
  const retainedFrontendDirs=(env.RETAINED_FRONTEND_DIRS??'').split(path.delimiter).filter(Boolean).map(value=>path.resolve(root,value));
  if(new Set(retainedFrontendDirs).size!==retainedFrontendDirs.length||retainedFrontendDirs.includes(frontendDir)){
    throw new ConfigurationError('RETAINED_FRONTEND_DIRS','must contain distinct prior release directories and must not include the current dist directory.');
  }
  if (appMode === 'service') {
    if (environment !== 'production') throw new ConfigurationError('NODE_ENV', 'must be production when APP_MODE is service.');
    if (!identity) throw new ConfigurationError('OIDC configuration', 'is required when APP_MODE is service.');
    if (!identity.lifecycle) throw new ConfigurationError('OIDC lifecycle configuration', 'is required when APP_MODE is service.');
    if (!identity.inviteEmailHashes?.length) throw new ConfigurationError('OIDC_INVITED_EMAILS', 'must contain the approved private-beta participants when APP_MODE is service.');
    if (identity.legacyLinkUntil !== null) throw new ConfigurationError('OIDC_LEGACY_LINK_UNTIL', 'must be omitted for the clean-data private beta.');
    if (!participantPolicy) throw new ConfigurationError('Participant policy', 'is required when APP_MODE is service.');
    if (!trustedProxies.length) throw new ConfigurationError('TRUST_PROXY', 'must identify the private HTTPS ingress when APP_MODE is service.');
    if (logRequests !== 'true') throw new ConfigurationError('LOG_REQUESTS', 'must be true when APP_MODE is service.');
    if (hasAzure || hasOpenAi) throw new ConfigurationError('AI configuration', 'must be omitted while managed external AI is disabled.');
    if (billing) throw new ConfigurationError('Stripe configuration', 'must be omitted while private-beta payments are disabled.');
  }
  return Object.freeze({
    environment,
    appMode,
    rootDir: root,
    frontendDir,
    retainedFrontendDirs:Object.freeze(retainedFrontendDirs),
    dataDir: path.resolve(root, dataDir),
    databaseUrl,
    publicOrigin,
    trustedProxies: Object.freeze(trustedProxies),
    logRequests: logRequests === 'true',
    fieldMetrics: fieldMetrics === 'true',
    participantPolicy,
    host,
    port: Number(portText),
    cookieSecure: cookieSecure === 'true',
    ai,
    identity,
    billing,
  });
}
