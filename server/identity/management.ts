import * as oidc from 'openid-client';
import { z } from 'zod';
import type { IdentityConfig } from '../config';
import { HttpError } from '../http-error';
import { identityFetch, subjectSchema, type IdentityTransport } from './broker';

const profileSchema = z.looseObject({
  user_id: subjectSchema, updated_at: z.iso.datetime(),
  last_password_reset: z.iso.datetime().nullable().optional(),
  blocked: z.boolean().optional(), email: z.string().max(254).optional(),
  email_verified: z.boolean().optional(),
});
export interface SecurityFacts {
  subject: string; version: number; cutoff: number; disabled: 0 | 1 | 2;
  email: string | null; verified: boolean;
}

export class IdentityManagement {
  private readonly client: oidc.Configuration;
  private token: Promise<string> | undefined;
  private cached: { value: string; expires: number } | undefined;
  private readonly transport: IdentityTransport;
  constructor(private readonly settings: NonNullable<IdentityConfig['lifecycle']>, shutdown: AbortSignal, transport: IdentityTransport = identityFetch) {
    this.transport = async (url, options) => {
      let response: Response;
      try {
        response = await transport(url, { ...options, redirect: 'manual', signal: AbortSignal.any([shutdown, AbortSignal.timeout(10000), ...(options.signal ? [options.signal] : [])]) });
      } catch (error) {
        if (error instanceof TypeError || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new HttpError(502, 'The identity security service is unavailable. Try again later.');
        throw error;
      }
      if (response.status >= 500 || response.status === 429) throw new HttpError(502, 'The identity security service is unavailable. No new authority was granted.');
      if (response.status >= 300 && response.status < 400) throw new HttpError(502, 'The identity security service redirected outside its fixed endpoint contract.');
      return response;
    };
    this.client = new oidc.Configuration({ issuer: `${settings.origin}/`, token_endpoint: `${settings.origin}/oauth/token` }, settings.clientId, settings.clientSecret);
    this.client[oidc.customFetch] = this.transport;
    this.client.timeout = 10;
  }
  private async credential() {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.value;
    const pending = this.token ??= (async () => {
      const value = await oidc.clientCredentialsGrant(this.client, { audience: `${this.settings.origin}/api/v2/`, scope: 'read:users' });
      const token = z.looseObject({
        access_token: z.string().min(1).max(16384), expires_in: z.number().int().min(60).max(86400), scope: z.string().optional(),
      }).parse(value);
      if (token.scope !== undefined && token.scope !== 'read:users') throw new HttpError(502, 'The machine client must have only read:users permission.');
      this.cached = { value: token.access_token, expires: Date.now() + token.expires_in * 1000 - 30000 };
      return token.access_token;
    })();
    try { return await pending; }
    catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof oidc.ClientError && error.cause instanceof HttpError) throw error.cause;
      throw new HttpError(502, 'The identity security credential could not be verified. No new authority was granted.');
    } finally { if (this.token === pending) this.token = undefined; }
  }
  async facts(subject: string, signal?: AbortSignal): Promise<SecurityFacts> {
    subjectSchema.parse(subject);
    const url = new URL(`${this.settings.origin}/api/v2/users/${encodeURIComponent(subject)}`);
    url.searchParams.set('fields', 'user_id,updated_at,last_password_reset,blocked,email,email_verified');
    url.searchParams.set('include_fields', 'true');
    const response = await this.transport(url.href, { method: 'GET', headers: { Authorization: `Bearer ${await this.credential()}`, Accept: 'application/json' }, signal, body: undefined, redirect: 'manual' });
    if (response.status === 404) return { subject, version: Date.now(), cutoff: Date.now(), disabled: 2, email: null, verified: false };
    if (!response.ok) {
      if (response.status === 401) this.cached = undefined;
      throw new HttpError(502, 'The identity security profile could not be read. No new authority was granted.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(502, 'The identity security profile is empty.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 16384) { await reader.cancel(); throw new HttpError(502, 'The identity security profile exceeds its size limit.'); }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof TypeError || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new HttpError(502, 'The identity security profile could not be received. No new authority was granted.');
      throw error;
    } finally { reader.releaseLock(); }
    let profile: z.infer<typeof profileSchema>;
    try { profile = profileSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) throw new HttpError(502, 'The identity security profile is malformed. No new authority was granted.');
      throw error;
    }
    const version = Date.parse(profile.updated_at), cutoff = profile.last_password_reset ? Date.parse(profile.last_password_reset) : 0;
    if (profile.user_id !== subject || version > Date.now() + 5000 || cutoff > Date.now() + 5000) throw new HttpError(502, 'The identity security profile does not match the requested authority.');
    return { subject, version, cutoff, disabled: profile.blocked ? 1 : 0, email: profile.email ?? null, verified: !!profile.email && profile.email_verified === true };
  }
}
