import * as oidc from 'openid-client';
import { z } from 'zod';
import type { IdentityConfig } from '../config';
import { HttpError } from '../http-error';

export type Provider = 'email' | 'google' | 'github';
export type IdentityTransport = oidc.CustomFetch;
export const identityFetch: IdentityTransport = (url, options) => fetch(url, {
  ...options, body: options.body instanceof Uint8Array ? new Uint8Array(options.body).buffer : options.body,
});
export const providers: readonly Provider[] = ['email', 'google', 'github'];
const prefixes = { email: 'auth0|', google: 'google-oauth2|', github: 'github|' } as const;
export const subjectSchema = z.string().max(512).regex(/^(?:auth0|google-oauth2|github)\|[\x21-\x7e]+$/);
const claimsSchema = z.looseObject({
  sub: subjectSchema,
  auth_time: z.number().int().nonnegative(),
  name: z.string().min(1).max(200).optional(),
  email: z.string().max(254).optional(),
  email_verified: z.boolean().optional(),
});
export interface IdentityProof {
  issuer: string;
  subject: string;
  name: string;
  email: string | null;
  verified: boolean;
  authenticatedAt: number;
}

export class IdentityBroker {
  private configuration: Promise<oidc.Configuration> | undefined;
  constructor(private readonly settings: IdentityConfig, private readonly origin: string, private readonly shutdown: AbortSignal, private readonly transport: IdentityTransport = identityFetch) {}

  private async discover() {
    const transport: IdentityTransport = async (url, options) => {
      let response: Response;
      try {
        response = await this.transport(url, {
          ...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), this.shutdown, AbortSignal.timeout(10000)]),
        });
      } catch (error) {
        if (error instanceof TypeError || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new HttpError(502, 'The sign-in service could not be reached. Try again later.');
        throw error;
      }
      if (response.status >= 500 || response.status === 429) throw new HttpError(502, 'The sign-in service is temporarily unavailable. Try again later.');
      return response;
    };
    const configuration = await oidc.discovery(new URL(this.settings.issuer), this.settings.clientId, {
      client_secret: this.settings.clientSecret,
      id_token_signed_response_alg: 'RS256',
      [oidc.clockTolerance]: 5,
    }, oidc.ClientSecretPost(this.settings.clientSecret), {
      [oidc.customFetch]: transport, timeout: 10, execute: [oidc.enableNonRepudiationChecks],
    });
    const metadata = configuration.serverMetadata();
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      const value = metadata[key];
      if (!value) throw new Error('Required broker endpoint is missing.');
      const url = new URL(value);
      if (url.origin !== new URL(this.settings.issuer).origin || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Broker endpoints must remain at the configured HTTPS issuer.');
    }
    return configuration;
  }
  private async client() {
    const pending = this.configuration ??= this.discover();
    try { return await pending; }
    catch {
      if (this.configuration === pending) this.configuration = undefined;
      throw new HttpError(502, 'The sign-in service is unavailable or its configuration could not be verified. Start again later.');
    }
  }
  async authorization(provider: Provider, state: string, nonce: string, verifier: string, fresh: boolean, signup: boolean) {
    return oidc.buildAuthorizationUrl(await this.client(), {
      redirect_uri: `${this.origin}/auth/callback`, response_type: 'code', response_mode: 'query',
      scope: 'openid profile email', state, nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
      connection: this.settings.connections[provider], max_age: fresh ? '0' : '86400',
      ...(fresh ? { prompt: 'login' } : {}), ...(signup && provider === 'email' ? { screen_hint: 'signup' } : {}),
    }).href;
  }
  async exchange(url: URL, provider: Provider, state: string, nonce: string, verifier: string, fresh: boolean): Promise<IdentityProof> {
    const configuration = await this.client();
    let claims: z.infer<typeof claimsSchema>;
    try {
      const tokens = await oidc.authorizationCodeGrant(configuration, url, {
        expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, maxAge: fresh ? 0 : 86400, idTokenExpected: true,
      });
      claims = claimsSchema.parse(tokens.claims());
      if (!claims.sub.startsWith(prefixes[provider]) || claims.auth_time * 1000 > Date.now() + 5000) throw new Error('Unexpected identity connection or authentication time.');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof oidc.ClientError && error.cause instanceof HttpError) throw error.cause;
      throw new HttpError(400, 'The sign-in response could not be verified. Start again; your saved work is unchanged.');
    }
    const email = claims.email?.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'The sign-in service returned an invalid contact address. Correct it with your provider and start again.');
    return {
      issuer: this.settings.issuer, subject: claims.sub,
      name: claims.name?.trim().slice(0, 60) || 'Studio member',
      email: email || null, verified: !!email && claims.email_verified === true, authenticatedAt: claims.auth_time * 1000,
    };
  }
}
