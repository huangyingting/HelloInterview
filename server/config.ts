import { isIP } from 'node:net';
import path from 'node:path';

export interface ServerConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly rootDir: string;
  readonly frontendDir: string;
  readonly dataDir: string;
  readonly host: string;
  readonly port: number;
  readonly cookieSecure: boolean;
  readonly ai: Readonly<{ apiKey: string; baseUrl: string; model: string }> | null;
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
  const dataDir = env.DATA_DIR ?? 'data';
  if (!dataDir.trim() || dataDir.includes('\0')) throw new ConfigurationError('DATA_DIR', 'must be a nonempty filesystem path.');
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
  const root = path.resolve(rootDir);
  return Object.freeze({
    environment,
    rootDir: root,
    frontendDir: path.join(root, 'dist'),
    dataDir: path.resolve(root, dataDir),
    host,
    port: Number(portText),
    cookieSecure: cookieSecure === 'true',
    ai: apiKey ? Object.freeze({ apiKey, baseUrl: baseUrl.href.replace(/\/+$/, ''), model }) : null,
  });
}
