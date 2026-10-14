import { createHmac } from 'node:crypto';
import { z } from 'zod';

const email = z.string().email().max(254);
const settings = [
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'AUTH_GOOGLE_CLIENT_ID',
  'AUTH_GOOGLE_CLIENT_SECRET',
  'AUTH_FACEBOOK_CLIENT_ID',
  'AUTH_FACEBOOK_CLIENT_SECRET',
  'AUTH_INVITED_EMAILS',
] as const;

export class AuthConfigurationError extends Error {
  constructor(setting: string, requirement: string) {
    super(`${setting} ${requirement}`);
    this.name = 'AuthConfigurationError';
  }
}

export interface AuthSettings {
  readonly origin: string;
  readonly secret: string;
  readonly google: Readonly<{ clientId: string; clientSecret: string }>;
  readonly facebook: Readonly<{ clientId: string; clientSecret: string }>;
  readonly inviteEmailHashes: readonly string[];
}

export function authCookieNames(settings: Pick<AuthSettings, 'origin'>) {
  const secure = settings.origin.startsWith('https://');
  return {
    secure,
    session: secure ? '__Host-studio_session' : 'studio_session',
    csrf: secure ? '__Host-studio_csrf' : 'studio_csrf',
  } as const;
}

export function invitationHash(secret: string, address: string) {
  return createHmac('sha256', secret).update(address.trim().toLowerCase()).digest('hex');
}

export function loadAuthSettings(env: NodeJS.ProcessEnv = process.env): Readonly<AuthSettings> | null {
  if (!settings.some(key => env[key] !== undefined)) return null;
  let origin: URL;
  try {
    const value = env.NEXTAUTH_URL;
    if (!value || /[\x00-\x20\x7f]/.test(value)) throw new Error('Invalid origin.');
    origin = new URL(value);
    const loopback = origin.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(origin.hostname);
    if (!(origin.protocol === 'https:' || loopback) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('Invalid origin.');
    }
  } catch {
    throw new AuthConfigurationError('NEXTAUTH_URL', 'must be an HTTPS origin or loopback HTTP origin without credentials, a path, query, or fragment.');
  }
  const secret = env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32 || secret.length > 4096 || /[\x00-\x20\x7f]/.test(secret)) {
    throw new AuthConfigurationError('NEXTAUTH_SECRET', 'must contain 32 to 4096 non-whitespace characters.');
  }
  const credential = (key: typeof settings[number], pattern: RegExp) => {
    const value = env[key];
    if (!value || value.length > 4096 || !pattern.test(value)) {
      throw new AuthConfigurationError(key, 'must be a bounded provider credential without whitespace or control characters.');
    }
    return value;
  };
  const google = Object.freeze({
    clientId: credential('AUTH_GOOGLE_CLIENT_ID', /^[^\s\x00-\x1f\x7f]{1,1000}$/),
    clientSecret: credential('AUTH_GOOGLE_CLIENT_SECRET', /^[^\s\x00-\x1f\x7f]{8,4096}$/),
  });
  const facebook = Object.freeze({
    clientId: credential('AUTH_FACEBOOK_CLIENT_ID', /^[A-Za-z0-9]{1,200}$/),
    clientSecret: credential('AUTH_FACEBOOK_CLIENT_SECRET', /^[^\s\x00-\x1f\x7f]{8,4096}$/),
  });
  const inviteText = env.AUTH_INVITED_EMAILS;
  if (!inviteText || inviteText.length > 65536) {
    throw new AuthConfigurationError('AUTH_INVITED_EMAILS', 'must contain 1 to 200 invited email addresses.');
  }
  const invitations = inviteText.split(',').map(value => value.trim().toLowerCase());
  if (invitations.length > 200 || invitations.some(value => !email.safeParse(value).success) || new Set(invitations).size !== invitations.length) {
    throw new AuthConfigurationError('AUTH_INVITED_EMAILS', 'must contain 1 to 200 distinct comma-separated email addresses.');
  }
  return Object.freeze({
    origin: origin.origin,
    secret,
    google,
    facebook,
    inviteEmailHashes: Object.freeze(invitations.map(value => invitationHash(secret, value))),
  });
}
