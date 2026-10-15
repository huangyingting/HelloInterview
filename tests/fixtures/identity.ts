import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type Stripe from 'stripe';
import { authCookieNames, loadAuthSettings } from '../../server/auth/config';
import { BillingNotifications } from '../../server/billing';
import { loadBillingConfig } from '../../server/billing/config';
import { postgresConnection } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrations';
import { closePrismaConnection } from '../../server/db/prisma';
import { StateRepository } from '../../server/db/state-repository';
import { migrateJobs } from '../../server/jobs';
import { closeNextAiService } from '../../server/next/ai';
import {
  closeNextBillingService,
  setNextBillingClientForTests,
  setNextBillingServiceForTests,
} from '../../server/next/billing';
import { closeNextPrivacyService } from '../../server/next/privacy';
import { PrivacyExports } from '../../server/privacy';
import type { Bootstrap, IdentitySecurity } from '../../shared/types';
import { dispatchNextRoute } from './next-router';

type Provider = 'email' | 'google' | 'github' | 'facebook';
type RequestOptions = {
  method?: string;
  headers: Record<string, string>;
  body?: string | Uint8Array | URLSearchParams | null;
  signal?: AbortSignal;
};

const origin = 'https://studio.fixture';
const authSecret = 'fixture-auth-secret-fixture-auth-secret-fixture-auth-secret';
let browserNumber = 0;

export async function fixtureFetch(url: string, options: RequestOptions): Promise<Response> {
  const body = options.body instanceof URLSearchParams
    ? options.body.toString()
    : options.body instanceof Uint8Array
      ? Buffer.from(options.body)
      : options.body;
  return fetch(url, { ...options, body });
}

export class IdentityBrowser {
  readonly cookies = new Map<string, string>();
  readonly ip = `198.18.${Math.floor(++browserNumber / 250)}.${browserNumber % 250 + 1}`;
  readonly address = origin;
  readonly host = new URL(origin).host;
  readonly ca = Buffer.alloc(0);
  csrf: string | undefined;

  private async send(
    path: string,
    method: string,
    body: BodyInit | undefined,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const response = await dispatchNextRoute(new Request(new URL(path, origin), {
      method,
      headers: {
        Host: this.host,
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-For': this.ip,
        Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
        ...headers,
      },
      body,
      signal,
    }));
    signal?.throwIfAborted();
    for (const value of response.headers.getSetCookie()) {
      const [entry] = value.split(';');
      const split = entry.indexOf('=');
      const name = entry.slice(0, split);
      const content = entry.slice(split + 1);
      if (!content) this.cookies.delete(name); else this.cookies.set(name, content);
    }
    return response;
  }

  request(path: string, data?: unknown, method?: string, extra: Record<string, string> = {}, signal?: AbortSignal) {
    const verb = method ?? (data === undefined ? 'GET' : 'POST');
    return this.send(path, verb, data === undefined ? undefined : JSON.stringify(data), {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extra,
    }, signal);
  }

  requestRaw(path: string, body: string | Uint8Array, extra: Record<string, string>) {
    return this.send(path, 'POST', typeof body === 'string' ? body : Buffer.from(body), extra);
  }

  async bootstrap(): Promise<Bootstrap> {
    const response = await this.request('/api/bootstrap');
    if (!response.ok) throw new Error(`Fixture bootstrap failed (${response.status}): ${await response.text()}`);
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

async function resetNextServices() {
  await closeNextAiService();
  await closeNextBillingService();
  await closeNextPrivacyService();
  await closePrismaConnection();
}

export async function openIdentityFixture(
  env: Readonly<Record<string, string | undefined>> = {},
  options: { billingClient?: Stripe } = {},
) {
  (process.env as Record<string, string | undefined>).NODE_ENV ??= 'test';
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL must identify a dedicated PostgreSQL identity fixture.');
  await resetNextServices();

  const root = postgresConnection(databaseUrl);
  const schema = `authjs_test_${randomUUID().replaceAll('-', '')}`;
  await root.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = postgresConnection(url.href);
  const databases = [db];
  const cleanup: (() => Promise<unknown>)[] = [];
  const runtime: Record<string, string | undefined> = {
    ...env,
    NODE_ENV: 'test',
    DATABASE_URL: url.href,
    NEXTAUTH_URL: origin,
    NEXTAUTH_SECRET: authSecret,
    AUTH_GOOGLE_CLIENT_ID: 'fixture-google-client',
    AUTH_GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
    AUTH_FACEBOOK_CLIENT_ID: '123456789',
    AUTH_FACEBOOK_CLIENT_SECRET: 'fixture-facebook-secret',
    AUTH_INVITED_EMAILS: 'owner@example.invalid',
    AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64url'),
  };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(runtime)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      for (const action of cleanup.reverse()) await action();
      await resetNextServices();
      setNextBillingServiceForTests(undefined);
      setNextBillingClientForTests(undefined);
    } finally {
      for (const database of databases.reverse()) await database.close();
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      try {
        await root.exec(`DROP SCHEMA IF EXISTS ${schema}_jobs CASCADE`);
        await root.exec(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await root.close();
      }
    }
  }

  try {
    await migrateDatabase(db);
    await migrateJobs(db);
    const auth = loadAuthSettings();
    if (!auth) throw new Error('Synthetic Auth.js configuration was not loaded.');
    const authSettings = auth;
    const billing = loadBillingConfig(process.env, {
      identity: true,
      databaseUrl: url.href,
      publicOrigin: origin,
    }, (setting, requirement) => {
      throw new Error(`${setting} ${requirement}`);
    });
    setNextBillingClientForTests(options.billingClient);
    const shutdown = new AbortController();
    cleanup.push(async () => shutdown.abort());
    const notifications = billing
      ? await BillingNotifications.open(db, billing, shutdown.signal, false, options.billingClient, origin)
      : undefined;
    if (notifications) {
      setNextBillingServiceForTests(notifications);
      cleanup.push(() => notifications.close());
    }
    const privacy = await PrivacyExports.open(db);
    cleanup.push(() => privacy.close());

    let defaultSubject = 'google|synthetic-owner';
    let defaultClaims: Record<string, unknown> = {};
    const repository = new StateRepository(db);

    async function issue(browser: IdentityBrowser, selected: Provider, overrides: Record<string, unknown>) {
      const claims = { ...defaultClaims, ...overrides };
      const subject = typeof claims.sub === 'string' ? claims.sub : defaultSubject;
      const provider = selected;
      const issuer = provider === 'google' ? 'https://accounts.google.com'
        : provider === 'facebook' ? 'https://www.facebook.com'
          : provider === 'github' ? 'https://github.com'
            : `${origin}/email`;
      const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : 'owner@example.invalid';
      const verified = claims.email_verified === undefined ? true : claims.email_verified === true;
      let identity = await db.prepare(
        'SELECT id,user_id FROM managed_identities WHERE issuer=? AND subject=?',
      ).get(issuer, subject);
      let owner: string;
      if (identity) {
        owner = String(identity.user_id);
      } else {
        owner = randomUUID();
        const identityId = randomUUID();
        await db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,NULL,NULL,0)')
          .run(owner, typeof claims.name === 'string' ? claims.name : 'Synthetic member');
        await repository.initialize(owner);
        await db.prepare(`INSERT INTO managed_identities
          (id,user_id,issuer,subject,provider,email,verified,available)
          VALUES(?,?,?,?,?,?,?,1)`)
          .run(identityId, owner, issuer, subject, provider, email, Number(verified));
        await db.prepare(`INSERT INTO managed_accounts
          (user_id,status,contact_email,contact_identity_id,contact_verified)
          VALUES(?,?,?,?,?)`)
          .run(owner, verified ? 'active' : 'pending-verification', email, identityId, Number(verified));
        identity = { id: identityId, user_id: owner };
      }
      const epoch = Number((await db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?')
        .get(owner))?.session_epoch);
      const rawToken = randomBytes(32).toString('hex');
      const token = createHash('sha256').update(rawToken).digest('hex');
      const rawCsrf = randomBytes(32).toString('hex');
      const csrf = createHash('sha256').update(rawCsrf).digest('hex');
      const now = Date.now();
      const mfa = Array.isArray(claims.amr) && claims.amr.some(value => value === 'mfa') ? now : 0;
      if (mfa > 0) {
        await db.prepare(`INSERT INTO managed_totp_credentials
          (user_id,secret_ciphertext,status,pending_expires,last_used_step,created_at,verified_at,updated_at)
          VALUES(?,?,'active',NULL,-1,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET status='active',pending_expires=NULL,
            verified_at=EXCLUDED.verified_at,updated_at=EXCLUDED.updated_at`)
          .run(owner, 'fixture-ciphertext-'.padEnd(80, 'x'), now, now, now);
      }
      await db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)')
        .run(token, owner, now + 30 * 86400000);
      await db.prepare(`INSERT INTO managed_sessions
        (token,id,identity_id,epoch,csrf_hash,authenticated_at,created_at,last_used,mfa_at)
        VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(token, randomUUID(), String(identity.id), epoch, csrf, now, now, now, mfa);
      const names = authCookieNames(authSettings);
      browser.cookies.set(names.session, rawToken);
      browser.cookies.set(names.csrf, rawCsrf);
      browser.csrf = rawCsrf;
      return owner;
    }

    async function replica() {
      const connection = postgresConnection(url.href);
      databases.push(connection);
      return {
        db: connection,
        billing: notifications,
        privacy,
        address: origin,
        browser: () => new IdentityBrowser(),
      };
    }

    return {
      db,
      schema,
      origin,
      address: origin,
      config: {
        databaseUrl: url.href,
        publicOrigin: origin,
        billing,
        identity: { clientSecret: authSettings.secret },
      },
      billing: notifications,
      privacy,
      cleanup,
      close,
      replica,
      browser: () => new IdentityBrowser(),
      setSubject(value: string) { defaultSubject = value; },
      setClaims(value: Record<string, unknown>) { defaultClaims = value; },
      async begin(_browser: IdentityBrowser, selected: Provider = 'google') {
        return new URL(`https://fixture.invalid/signin?provider=${selected}`);
      },
      async complete(
        browser: IdentityBrowser,
        authorization: URL,
        overrides: Record<string, unknown> = {},
      ) {
        const selected = authorization.searchParams.get('provider');
        if (!['email', 'google', 'github', 'facebook'].includes(selected ?? '')) {
          return new Response(null, { status: 400 });
        }
        await issue(browser, selected as Provider, overrides);
        return new Response(null, { status: 303, headers: { Location: '/account' } });
      },
      async freshen(browser: IdentityBrowser) {
        const names = authCookieNames(authSettings);
        const raw = browser.cookies.get(names.session);
        if (!raw) throw new Error('The browser has no managed session.');
        const token = createHash('sha256').update(raw).digest('hex');
        await db.prepare(`UPDATE managed_sessions
          SET authenticated_at=floor(extract(epoch from clock_timestamp())*1000)::bigint
          WHERE token=?`).run(token);
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Auth.js fixture setup and cleanup failed.');
    }
    throw error;
  }
}

export function registerFixtureCleanup(t: TestContext, fixture: { close(): Promise<void> }) {
  t.after(() => fixture.close());
}
