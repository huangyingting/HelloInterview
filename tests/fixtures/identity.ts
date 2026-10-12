import express from 'express';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest, type Server } from 'node:http';
import { createServer, request as httpsRequest } from 'node:https';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { postgresConnection } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrations';
import { createApp, handleError } from '../../server/app';
import { loadConfig } from '../../server/config';
import type { Provider } from '../../server/identity/broker';
import type { Bootstrap, IdentitySecurity } from '../../shared/types';
import { IdentityLifecycle } from '../../server/identity/lifecycle';
import { migrateJobs } from '../../server/jobs';
import type { IdentityTransport } from '../../server/identity/broker';
import { BillingNotifications } from '../../server/billing';
import type Stripe from 'stripe';

const clientId = 'synthetic-client', clientSecret = 'synthetic-client-secret';
let browserNumber = 0;
export function fixtureFetch(url: string, options: { method?: string; headers: Record<string, string>; body?: string | Uint8Array | URLSearchParams | null; signal?: AbortSignal; ca?: Buffer }): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = options.body instanceof URLSearchParams ? options.body.toString() : options.body;
    const headers = { ...options.headers, ...(body == null ? {} : { 'Content-Length': String(Buffer.byteLength(body)) }) };
    const request = (url.startsWith('https:') ? httpsRequest : httpRequest)(url, { ...options, headers }, async response => {
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
        const status = response.statusCode ?? 500;
        resolve(new Response([204, 205, 304].includes(status) ? null : new Uint8Array(Buffer.concat(chunks)), { status, headers }));
      } catch (error) { reject(error); }
    });
    request.on('error', reject);
    request.end(body);
  });
}
function key() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...pair, kid: randomUUID(), jwk: pair.publicKey.export({ format: 'jwk' }) };
}
export class IdentityBrowser {
  readonly cookies = new Map<string, string>();
  readonly ip = `198.18.${Math.floor(++browserNumber / 250)}.${browserNumber % 250 + 1}`;
  csrf: string | undefined;
  constructor(readonly address: string, readonly host: string, readonly ca: Buffer) {}
  async request(path: string, data?: unknown, method?: string, extra: Record<string, string> = {}) {
    const response = await fixtureFetch(`${this.address}${path}`, {
      method: method ?? (data === undefined ? 'GET' : 'POST'),
      headers: {
        Host: this.host, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': this.ip,
        Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}), ...extra,
      }, body: data === undefined ? undefined : JSON.stringify(data), ca: this.ca,
    });
    for (const value of response.headers.getSetCookie()) {
      const [entry] = value.split(';'), split = entry.indexOf('='), name = entry.slice(0, split), content = entry.slice(split + 1);
      if (!content) this.cookies.delete(name); else this.cookies.set(name, content);
    }
    return response;
  }
  async bootstrap(): Promise<Bootstrap> {
    const response = await this.request('/api/bootstrap');
    if (!response.ok) throw new Error(`Fixture bootstrap failed (${response.status}).`);
    const data: Bootstrap = await response.json();
    this.csrf = data.csrf;
    return data;
  }
  async security(): Promise<IdentitySecurity> {
    const response = await this.request('/api/identity/security');
    if (!response.ok) throw new Error(`Fixture security failed (${response.status}).`);
    return response.json();
  }
}

export async function openIdentityFixture(env: NodeJS.ProcessEnv = {}, options: { brokerHostname?: string; lifecycle?: boolean; billingClient?: Stripe } = {}) {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL must identify a dedicated PostgreSQL identity fixture.');
  const tlsDir = await mkdtemp(join(tmpdir(), 'studio-identity-tls-'));
  const root = postgresConnection(databaseUrl), schema = `iam_test_${randomUUID().replaceAll('-', '')}`;
  await root.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = postgresConnection(url.href), databases = [db], servers: Server[] = [], shutdowns: AbortController[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  async function close() {
    for (const shutdown of shutdowns) shutdown.abort();
    for (const action of cleanup) await action();
    for (const server of servers) {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
    for (const database of databases) await database.close();
    try {
      await root.exec(`DROP SCHEMA IF EXISTS ${schema}_jobs CASCADE`);
      await root.exec(`DROP SCHEMA ${schema} CASCADE`);
    } finally { try { await root.close(); } finally { await rm(tlsDir, { recursive: true, force: true }); } }
  }
  try {
    await migrateDatabase(db);
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(tlsDir, 'key.pem'), '-out', join(tlsDir, 'cert.pem'), '-days', '1',
      '-subj', '/CN=studio.fixture', '-addext', 'subjectAltName=DNS:studio.fixture,DNS:broker.fixture,IP:127.0.0.1']);
    const certificate = await readFile(join(tlsDir, 'cert.pem'));
    const tls = { key: await readFile(join(tlsDir, 'key.pem')), cert: certificate };
    let issuer = 'https://broker.fixture/', origin = 'https://studio.fixture';
    let currentKey = key(), nextKey = key(), jwksKeys = [currentKey, nextKey], defaultSubject = 'google-oauth2|synthetic-owner';
    let defaultClaims: Record<string, unknown> = {};
    const profiles = new Map<string, Record<string, unknown>>(), deleted = new Set<string>();
    const managementRequests: string[] = [];
    let managementScope = 'read:users';
    const codes = new Map<string, { params: URLSearchParams; overrides: Record<string, unknown>; badSignature: boolean; algorithm: string }>();
    const observed: { path: string; parameters: URLSearchParams }[] = [];
    let unavailable = false;
    const brokerApp = express();
    brokerApp.use(express.urlencoded({ extended: false }));
    brokerApp.get('/.well-known/openid-configuration', (_req, res) => {
      if (unavailable) return res.status(503).json({ error: 'synthetic-unavailable' });
      res.json({
        issuer, authorization_endpoint: `${issuer}authorize`, token_endpoint: `${issuer}oauth/token`,
        jwks_uri: `${issuer}.well-known/jwks.json`, response_types_supported: ['code'],
        subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'],
      });
    });
    brokerApp.get('/.well-known/jwks.json', (_req, res) => unavailable ? res.status(503).json({ error: 'synthetic-unavailable' }) : res.json({ keys: jwksKeys.map(key => ({ ...key.jwk, alg: 'RS256', use: 'sig', kid: key.kid })) }));
    function authorize(params: URLSearchParams, overrides: Record<string, unknown> = {}, badSignature = false, algorithm = 'RS256') {
      const code = randomUUID();
      codes.set(code, { params, overrides: { sub: defaultSubject, ...defaultClaims, ...overrides }, badSignature, algorithm });
      const callback = new URL(params.get('redirect_uri') ?? `${origin}/auth/callback`);
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', params.get('state') ?? '');
      callback.searchParams.set('iss', issuer);
      return callback;
    }
    brokerApp.get('/authorize', (req, res) => {
      const params = new URL(req.originalUrl, issuer).searchParams;
      res.redirect(303, authorize(params).href);
    });
    brokerApp.post('/oauth/token', (req, res) => {
      if (unavailable) return res.status(503).json({ error: 'synthetic-unavailable' });
      if (req.body.grant_type === 'client_credentials') {
        if (req.body.client_id !== 'synthetic-manager' || req.body.client_secret !== 'synthetic-management-secret' ||
          req.body.audience !== `${new URL(issuer).origin}/api/v2/` || req.body.scope !== 'read:users') return res.status(401).json({ error: 'invalid_client' });
        return res.json({ token_type: 'Bearer', access_token: 'synthetic-management-token', expires_in: 3600, scope: managementScope });
      }
      const params = new URLSearchParams(req.body), code = params.get('code') ?? '', saved = codes.get(code);
      codes.delete(code);
      observed.push({ path: '/oauth/token', parameters: params });
      if (!saved || params.get('client_id') !== clientId || params.get('client_secret') !== clientSecret ||
          createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url') !== saved.params.get('code_challenge') ||
          params.get('redirect_uri') !== saved.params.get('redirect_uri')) return res.status(400).json({ error: 'invalid_grant' });
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: issuer, aud: clientId, sub: defaultSubject, iat: now, exp: now + 120, auth_time: now,
        nonce: saved.params.get('nonce'), name: 'Synthetic member', email: 'owner@example.invalid', email_verified: true, ...saved.overrides };
      if (typeof claims.sub === 'string' && !profiles.has(claims.sub) && !deleted.has(claims.sub)) {
        profiles.set(claims.sub, { user_id: claims.sub, updated_at: new Date(Date.now() - 10000).toISOString(), blocked: false, email: claims.email, email_verified: claims.email_verified });
      }
      const header = Buffer.from(JSON.stringify({ alg: saved.algorithm, kid: currentKey.kid })).toString('base64url');
      const body = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
      const signature = saved.algorithm === 'none' ? '' : sign('RSA-SHA256', Buffer.from(body), saved.badSignature ? key().privateKey : currentKey.privateKey).toString('base64url');
      res.json({ token_type: 'Bearer', access_token: 'synthetic-access-token', expires_in: 120, id_token: `${body}.${signature}` });
    });
    brokerApp.get('/api/v2/users/:subject', (req, res) => {
      if (unavailable) return res.status(503).json({ error: 'synthetic-unavailable' });
      if (req.get('Authorization') !== 'Bearer synthetic-management-token') return res.status(401).json({ error: 'invalid_token' });
      managementRequests.push(req.originalUrl);
      const profile = profiles.get(req.params.subject);
      if (!profile) return res.status(404).json({ error: 'not_found' });
      res.json(profile);
    });
    const broker = createServer(tls, brokerApp);
    servers.push(broker); broker.listen(0, '127.0.0.1'); await once(broker, 'listening');
    const brokerAddress = broker.address();
    if (!brokerAddress || typeof brokerAddress === 'string') throw new Error('Synthetic broker did not listen.');
    const brokerUrl = `https://127.0.0.1:${brokerAddress.port}`;
    issuer = `https://${options.brokerHostname ?? 'broker.fixture'}:${brokerAddress.port}/`;
    const initialServer = createServer(tls);
    servers.push(initialServer); initialServer.listen(0, '127.0.0.1'); await once(initialServer, 'listening');
    const initialAddress = initialServer.address();
    if (!initialAddress || typeof initialAddress === 'string') throw new Error('Synthetic HTTPS app did not listen.');
    origin = `https://studio.fixture:${initialAddress.port}`;
    const config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: url.href, PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'true', TRUST_PROXY: '127.0.0.1/32',
      OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret, ...env,
      ...(options.lifecycle ? { OIDC_MANAGEMENT_ORIGIN: new URL(issuer).origin, OIDC_MANAGEMENT_CLIENT_ID: 'synthetic-manager',
        OIDC_MANAGEMENT_CLIENT_SECRET: 'synthetic-management-secret', OIDC_PASSWORD_HOOK_SECRET: '1'.repeat(64) } : {}),
    });
    if (config.identity?.lifecycle || config.billing) await migrateJobs(db);
    async function replica(server = createServer(tls)) {
      const connection = postgresConnection(url.href), shutdown = new AbortController();
      databases.push(connection); shutdowns.push(shutdown);
      const transport: IdentityTransport = async (url, options) => {
        const requested = new URL(url);
        if (requested.origin !== new URL(issuer).origin) throw new Error('Fixture transport refused an unexpected issuer.');
        const body = options.body;
        if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof URLSearchParams)) throw new Error('The synthetic OIDC fixture received an unsupported request body.');
        return fixtureFetch(`${brokerUrl}${requested.pathname}${requested.search}`, { method: options.method, headers: options.headers, body, signal: options.signal, ca: certificate });
      };
      const lifecycle = config.identity?.lifecycle ? await IdentityLifecycle.open(connection, config.identity, shutdown.signal, transport) : undefined;
      if (lifecycle) cleanup.push(() => lifecycle.close());
      const billing = config.billing ? await BillingNotifications.open(connection, config.billing, shutdown.signal, false, options.billingClient, config.publicOrigin ?? undefined) : undefined;
      if (billing) cleanup.push(() => billing.close());
      const app = createApp(config, connection, shutdown.signal, shutdown.signal, transport, lifecycle, billing);
      app.use(express.static(config.frontendDir));
      app.get('/{*path}', (_req, res) => res.sendFile(`${config.frontendDir}/index.html`));
      app.use(handleError);
      server.on('request', app);
      if (!servers.includes(server)) { servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Synthetic app did not listen.');
      return { db: connection, lifecycle, billing, address: `https://127.0.0.1:${address.port}`, browser: () => new IdentityBrowser(`https://127.0.0.1:${address.port}`, new URL(origin).host, certificate) };
    }
    const application = await replica(initialServer);
    return {
      ...application, schema, config, close, replica, cleanup, brokerUrl, origin, issuer, authorize, observed, certificatePath: join(tlsDir, 'cert.pem'),
      managementRequests,
      setProfile(subject: string, values: Record<string, unknown>) {
        deleted.delete(subject);
        profiles.set(subject, { user_id: subject, email: 'owner@example.invalid', email_verified: true, blocked: false, ...profiles.get(subject), updated_at: new Date().toISOString(), ...values });
      },
      deleteProfile(subject: string) { profiles.delete(subject); deleted.add(subject); },
      managementScope(value: string) { managementScope = value; },
      proxyTo(target: string) {
        const url = new URL(target);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('The synthetic gateway only proxies its loopback child.');
        initialServer.removeAllListeners('request');
        initialServer.on('request', (request, response) => {
          const upstream = httpRequest(new URL(request.url ?? '/', url), {
            method: request.method, headers: { ...request.headers, 'x-forwarded-proto': 'https' },
          }, result => { response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response); });
          upstream.on('error', () => {
            if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'The synthetic runtime gateway is unavailable.' }));
          });
          request.pipe(upstream);
        });
      },
      setSubject(value: string) { defaultSubject = value; },
      setClaims(value: Record<string, unknown>) { defaultClaims = value; },
      unavailable(value: boolean) { unavailable = value; },
      rotateKey() { currentKey = nextKey; nextKey = key(); jwksKeys = [...jwksKeys, nextKey]; },
      async begin(browser: IdentityBrowser, selected: Provider = 'google') {
        const response = await browser.request(`/auth/login?provider=${selected}`);
        const location = response.headers.get('location');
        if (response.status !== 303 || !location?.startsWith(issuer)) throw new Error(`Synthetic sign-in initiation failed (${response.status} ${location}).`);
        return new URL(location);
      },
      async complete(browser: IdentityBrowser, authorization: URL, overrides: Record<string, unknown> = {}, badSignature = false, algorithm = 'RS256') {
        const callback = authorize(authorization.searchParams, overrides, badSignature, algorithm);
        return browser.request(`${callback.pathname}${callback.search}`);
      },
    };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Identity fixture setup and cleanup failed.'); }
    throw error;
  }
}
