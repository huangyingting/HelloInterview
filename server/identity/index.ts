import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type express from 'express';
import { z } from 'zod';
import type { User } from '../../shared/types';
import type { IdentityConfig } from '../config';
import type { Database } from '../db/connection';
import { StateRepository } from '../db/state-repository';
import { HttpError } from '../http-error';
import { IdentityBroker, providers, type IdentityProof, type IdentityTransport, type Provider } from './broker';
import { IdentityLimits, networkAddress } from './limits';
import { lockSubject, type IdentityLifecycle } from './lifecycle';
import type { SecurityFacts } from './management';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('hex');
const cookieNames = { session: '__Host-studio_session', csrf: '__Host-studio_csrf', binding: '__Host-studio_auth' } as const;
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
const lifetime = 30 * 86400000, idle = 7 * 86400000, freshness = 10 * 60000;
const clockSql = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const statusSchema = z.enum(['pending-verification', 'active', 'suspended', 'deletion-pending']);
const sessionSchema = z.object({
  id: z.string(), name: z.string(), contact_email: z.string().nullable(), contact_verified: z.number().int().min(0).max(1),
  status: statusSchema, epoch: z.number().int().nonnegative(), token: z.string(), session_id: z.string(),
  identity_id: z.string(), csrf_hash: z.string(), authenticated_at: z.coerce.number().int().nonnegative(),
});
type Session = z.infer<typeof sessionSchema>;
const transactionSchema = z.object({
  provider: z.enum(['email', 'google', 'github']), purpose: z.enum(['login', 'reauth', 'link', 'legacy-link']),
  verifier: z.string(), nonce: z.string(), user_id: z.string().nullable(), session_hash: z.string().nullable(), legacy_credential_hash: z.string().nullable(), return_to: z.string(),
  requires_fresh: z.number().int().min(0).max(1),
});
function cookie(req: express.Request, name: string) {
  const values = req.headers.cookie?.split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`)) ?? [];
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function equal(a: string, b: string) {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
function provider(value: unknown): Provider {
  if (typeof value !== 'string' || !providers.includes(value as Provider)) throw new HttpError(400, 'Choose email, Google or GitHub sign-in.');
  return value as Provider;
}
function destination(value: unknown) {
  if (value === undefined) return '/account';
  if (typeof value !== 'string' || !['/account', '/dashboard', '/pricing', '/premium/studio'].includes(value)) throw new HttpError(400, 'Choose a supported Studio return destination.');
  return value;
}

export class ManagedIdentity {
  private readonly broker: IdentityBroker;
  private readonly limits: IdentityLimits;
  private readonly contexts = new WeakMap<User, Session>();
  constructor(private readonly db: Database, private readonly settings: IdentityConfig, private readonly origin: string, shutdown: AbortSignal, transport?: IdentityTransport, private readonly lifecycle?: IdentityLifecycle) {
    if (db.dialect !== 'postgres') throw new Error('Managed identity requires migrated PostgreSQL.');
    this.broker = new IdentityBroker(settings, origin, shutdown, transport);
    this.limits = new IdentityLimits(db, settings.clientSecret);
  }
  private async now() { return z.coerce.number().int().nonnegative().parse((await this.db.prepare(`SELECT ${clockSql} AS now`).get())?.now); }
  private async session(req: express.Request): Promise<Session | null> {
    const raw = cookie(req, cookieNames.session);
    if (!raw) return null;
    const row = await this.db.prepare(`
      SELECT u.id,u.name,a.contact_email,a.contact_verified,a.status,a.session_epoch AS epoch,
        s.token,m.id AS session_id,m.identity_id,m.csrf_hash,m.authenticated_at
      FROM sessions s JOIN managed_sessions m ON m.token=s.token JOIN users u ON u.id=s.user_id
        JOIN managed_accounts a ON a.user_id=u.id JOIN managed_identities i ON i.id=m.identity_id AND i.user_id=u.id
      WHERE s.token=? AND s.expires>${clockSql} AND m.last_used>${clockSql}-?
        AND m.epoch=a.session_epoch AND i.available=1 AND m.authenticated_at>a.security_cutoff
    `).get(hash(raw), idle);
    if (!row) return null;
    const session = sessionSchema.parse(row);
    await this.db.prepare(`UPDATE managed_sessions SET last_used=${clockSql} WHERE token=?`).run(session.token);
    return session;
  }
  async user(req: express.Request): Promise<User | null> {
    const session = await this.session(req);
    if (!session) return null;
    const user: User = { id: session.id, name: session.name, email: session.contact_email ?? '', demo: false, identity: { status: session.status, verified: session.contact_verified === 1 } };
    this.contexts.set(user, session);
    return user;
  }
  private async requireSession(req: express.Request, fresh = false) {
    const session = await this.session(req);
    if (!session) throw new HttpError(401, 'Sign in again to manage account security.');
    if (!['active', 'pending-verification'].includes(session.status)) throw new HttpError(403, 'This account is not available for product access. Contact support.');
    if (fresh && await this.now() - session.authenticated_at > freshness) throw new HttpError(403, 'Confirm your identity again before changing security settings or exporting data.');
    return session;
  }
  async assertWritable(user: User, fresh = false, allowPending = false) {
    const context = this.contexts.get(user);
    if (!context) throw new HttpError(401, 'Sign in again.');
    await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(user.id);
    const row = await this.db.prepare(`
      SELECT a.status FROM managed_accounts a JOIN sessions s ON s.user_id=a.user_id JOIN managed_sessions m ON m.token=s.token
      WHERE a.user_id=? AND s.token=? AND a.session_epoch=m.epoch AND s.expires>${clockSql} AND m.last_used>${clockSql}-?
        AND (?=0 OR m.authenticated_at>${clockSql}-?)
      FOR UPDATE OF a,s,m
    `).get(user.id, context.token, idle, Number(fresh), freshness);
    if (!row || !['active', ...(allowPending ? ['pending-verification'] : [])].includes(String(row.status))) throw new HttpError(403, 'Your account session or verification changed. Sign in again; your saved work is unchanged.');
  }
  async admitBilling(user: User, res: express.Response) {
    await this.limits.enforce('billing', user.id, res);
  }
  async csrf(req: express.Request, res: express.Response) {
    const session = await this.session(req);
    const value = cookie(req, cookieNames.csrf);
    if (value && (!session || equal(hash(value), session.csrf_hash))) return value;
    const token = random();
    if (session) await this.db.prepare('UPDATE managed_sessions SET csrf_hash=? WHERE token=?').run(hash(token), session.token);
    res.cookie(cookieNames.csrf, token, { ...cookieOptions, maxAge: lifetime });
    return token;
  }
  async checkMutation(req: express.Request) {
    const value = req.get('X-CSRF-Token'), expected = cookie(req, cookieNames.csrf);
    if (!value || !expected || !equal(value, expected)) throw new HttpError(403, 'Your security token changed or is missing. Refresh this page before trying again.');
    const session = await this.session(req);
    if (session && !equal(hash(value), session.csrf_hash)) throw new HttpError(403, 'Your security token belongs to a different session. Refresh this page.');
  }
  private async audit(userId: string, action: string, identityId: string | null = null) {
    await this.db.prepare('INSERT INTO identity_security_events (id,user_id,action,identity_id) VALUES (?,?,?,?)').run(randomUUID(), userId, action, identityId);
  }
  private async issue(userId: string, identityId: string, authenticatedAt: number) {
    const now = await this.now(), token = random(), csrf = random();
    const account = await this.db.prepare('SELECT session_epoch,status FROM managed_accounts WHERE user_id=?').get(userId);
    if (!account || !['active', 'pending-verification'].includes(String(account.status))) throw new HttpError(403, 'This account is not available. Contact support.');
    await this.db.prepare('DELETE FROM sessions WHERE user_id=? AND expires<=?').run(userId, now);
    await this.db.prepare('DELETE FROM sessions WHERE token IN (SELECT s.token FROM sessions s JOIN managed_sessions m ON m.token=s.token WHERE s.user_id=? ORDER BY m.created_at DESC,m.id DESC OFFSET 49)').run(userId);
    await this.db.prepare('INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)').run(hash(token), userId, now + lifetime);
    await this.db.prepare('INSERT INTO managed_sessions (token,id,identity_id,epoch,csrf_hash,authenticated_at,created_at,last_used) VALUES (?,?,?,?,?,?,?,?)').run(hash(token), randomUUID(), identityId, Number(account.session_epoch), hash(csrf), authenticatedAt, now, now);
    return { token, csrf };
  }
  private cookies(res: express.Response, issued: { token: string; csrf: string }) {
    res.cookie(cookieNames.session, issued.token, { ...cookieOptions, maxAge: lifetime });
    res.cookie(cookieNames.csrf, issued.csrf, { ...cookieOptions, maxAge: lifetime });
  }
  private async start(req: express.Request, res: express.Response, purpose: 'login' | 'reauth' | 'link' | 'legacy-link', userId: string | null = null, legacyCredentialHash: string | null = null) {
    const body = purpose === 'login' ? req.query : req.body;
    const selected = provider(body?.provider), returnTo = destination(body?.returnTo);
    let sessionHash: string | null = null;
    if (purpose === 'reauth' || purpose === 'link') {
      const session = await this.requireSession(req, purpose === 'link');
      userId = session.id;
      sessionHash = session.token;
    }
    const state = random(), nonce = random(), verifier = random(), binding = cookie(req, cookieNames.binding) ?? random(), now = await this.now();
    const fresh = purpose !== 'login' || body?.fresh === 'true';
    const url = await this.broker.authorization(selected, state, nonce, verifier, fresh, body?.signup === 'true');
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM auth_transactions WHERE expires<=?').run(now);
      await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`auth-flow:${hash(binding)}`);
      const count = await this.db.prepare('SELECT count(*)::integer AS count FROM auth_transactions WHERE binding_hash=?').get(hash(binding));
      if (Number(count?.count) >= 8) throw new HttpError(429, 'Finish an existing sign-in attempt or wait ten minutes before starting another.');
      await this.db.prepare('INSERT INTO auth_transactions (state_hash,binding_hash,verifier,nonce,provider,purpose,user_id,session_hash,legacy_credential_hash,return_to,expires,created_at,requires_fresh) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(hash(state), hash(binding), verifier, nonce, selected, purpose, userId, sessionHash, legacyCredentialHash, returnTo, now + freshness, now, Number(fresh));
    });
    res.cookie(cookieNames.binding, binding, { ...cookieOptions, maxAge: freshness });
    return url;
  }
  private async bind(proof: IdentityProof, selected: Provider, purpose: string, target: string | null, legacyCredentialHash: string | null, initiating?: { req: express.Request; token: string }, preceding?: Session | null, facts?: SecurityFacts) {
    // Serialize subject creation across replicas before taking an account lock.
    await lockSubject(this.db, proof.issuer, proof.subject);
    const existing = await this.db.prepare('SELECT id,user_id FROM managed_identities WHERE issuer=? AND subject=?').get(proof.issuer, proof.subject);
    if (target && existing && existing.user_id !== target) throw new HttpError(409, 'This sign-in method already belongs to another Studio account. No accounts were merged.');
    if (purpose === 'reauth' && (!existing || existing.user_id !== target)) throw new HttpError(403, 'Confirm with a sign-in method already connected to this account.');
    if (['link', 'legacy-link'].includes(purpose) && !proof.verified) throw new HttpError(403, 'Use a sign-in method with a verified contact email before linking this account.');
    const userId = target ?? (existing ? String(existing.user_id) : randomUUID());
    if (!existing && !target) {
      await this.db.prepare('INSERT INTO users (id,name,email,password,demo) VALUES (?,?,NULL,NULL,0)').run(userId, proof.name);
      await new StateRepository(this.db).initialize(userId);
    }
    await this.db.prepare('SELECT id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE').all(userId, preceding?.id ?? null);
    if (this.lifecycle && facts) await this.lifecycle.assertProof(proof, facts, userId);
    if (initiating) {
      const current = await this.requireSession(initiating.req, purpose === 'link');
      if (current.token !== initiating.token || current.id !== userId) throw new HttpError(403, 'Your account session changed while you were confirming it. Start again.');
    }
    const account = await this.db.prepare('SELECT status,contact_email,contact_verified,contact_identity_id FROM managed_accounts WHERE user_id=? FOR UPDATE').get(userId);
    if (account && !['active', 'pending-verification'].includes(String(account.status))) throw new HttpError(403, 'This account is not available. Contact support.');
    if (purpose === 'legacy-link') {
      if (!this.settings.legacyLinkUntil || await this.now() >= this.settings.legacyLinkUntil || account) throw new HttpError(403, 'The legacy migration window is closed or this account has already migrated.');
      const legacy = await this.db.prepare('SELECT password,demo FROM users WHERE id=?').get(userId);
      if (typeof legacy?.password !== 'string' || legacy.demo !== 0 || !legacyCredentialHash || !equal(hash(legacy.password), legacyCredentialHash)) throw new HttpError(403, 'The legacy credential changed. Start migration again with your current credential.');
      await this.db.prepare('UPDATE users SET password=NULL,email=NULL WHERE id=?').run(userId);
      await this.db.prepare('UPDATE user_settings SET plan=?,plan_expires_at=NULL,revision=revision+1 WHERE user_id=?').run('free', userId);
      await this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    }
    const identityId = existing ? String(existing.id) : randomUUID();
    if (!existing) {
      const count = await this.db.prepare('SELECT count(*)::integer AS count FROM managed_identities WHERE user_id=?').get(userId);
      if (Number(count?.count) >= 10) throw new HttpError(409, 'This account has reached its sign-in method limit. Remove an unused method first.');
    }
    if (!existing) await this.db.prepare('INSERT INTO managed_identities (id,user_id,issuer,subject,provider,email,verified) VALUES (?,?,?,?,?,?,?)').run(identityId, userId, proof.issuer, proof.subject, selected, proof.email, Number(proof.verified));
    else await this.db.prepare('UPDATE managed_identities SET email=?,verified=?,available=1 WHERE id=?').run(proof.email, Number(proof.verified), identityId);
    const status = proof.verified ? 'active' : 'pending-verification';
    if (!account) await this.db.prepare('INSERT INTO managed_accounts (user_id,status,contact_email,contact_verified,contact_identity_id) VALUES (?,?,?,?,?)').run(userId, status, proof.email, Number(proof.verified), identityId);
    else if (account.contact_identity_id === identityId || account.contact_verified !== 1 && proof.verified) {
      const changed = account.contact_email !== proof.email || account.contact_verified !== Number(proof.verified);
      await this.db.prepare('UPDATE managed_accounts SET status=?,contact_email=?,contact_verified=?,contact_identity_id=?,session_epoch=session_epoch+? WHERE user_id=?').run(status, proof.email, Number(proof.verified), identityId, Number(changed), userId);
      if (changed) await this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    }
    await this.audit(userId, purpose, identityId);
    return { userId, identityId };
  }
  register(app: express.Express) {
    const rateLimit: express.RequestHandler = async (req, res, next) => {
      if (!req.ip) throw new HttpError(503, 'The request address is unavailable. Sign-in was not admitted.');
      await this.limits.enforce('network', networkAddress(req.ip), res);
      next();
    };
    const accountLimit: express.RequestHandler = async (req, res, next) => {
      const session = await this.requireSession(req);
      await this.limits.enforce('account-security', session.id, res);
      next();
    };
    const browserError: express.ErrorRequestHandler = (error: unknown, _req, res, next) => {
      if (!(error instanceof HttpError)) return next(error);
      const code = error.status >= 500 ? 'provider_unavailable' : error.status === 409 ? 'identity_conflict' : error.status === 403 ? 'security_changed' : error.status === 429 ? 'rate_limited' : 'restart';
      console.error(JSON.stringify({ event: 'identity.flow.failed', requestId: res.locals.requestId, code }));
      res.redirect(303, `/auth?error=${code}`);
    };
    app.get('/auth/login', rateLimit, async (req: express.Request, res: express.Response) => res.redirect(303, await this.start(req, res, 'login')), browserError);
    app.get('/auth/callback', rateLimit, async (req: express.Request, res: express.Response) => {
      const state = req.query.state, binding = cookie(req, cookieNames.binding);
      if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || !binding) throw new HttpError(400, 'This sign-in request is missing its browser proof. Restart sign-in in this browser.');
      const row = await this.db.prepare(`DELETE FROM auth_transactions WHERE state_hash=? AND binding_hash=? AND expires>${clockSql} RETURNING *`).get(hash(state), hash(binding));
      if (!row) throw new HttpError(400, 'This sign-in request expired or was already used. Start again.');
      const transaction = transactionSchema.parse(row);
      if (transaction.session_hash) {
        const session = await this.requireSession(req, transaction.purpose === 'link');
        if (session.token !== transaction.session_hash || session.id !== transaction.user_id) throw new HttpError(403, 'Your account session changed. Start this security action again.');
      }
      const callback = new URL('/auth/callback', this.origin);
      callback.search = new URL(req.originalUrl, this.origin).search;
      const proof = await this.broker.exchange(callback, transaction.provider, state, transaction.nonce, transaction.verifier, transaction.requires_fresh === 1);
      const facts = this.lifecycle ? await this.lifecycle.management.facts(proof.subject) : undefined;
      if (this.lifecycle && facts) {
        await this.lifecycle.observe(facts);
        await this.lifecycle.assertProof(proof, facts);
      }
      const preceding = await this.session(req);
      const issued = await this.db.transaction(async () => {
        const result = await this.bind(proof, transaction.provider, transaction.purpose, transaction.user_id, transaction.legacy_credential_hash, transaction.session_hash ? { req, token: transaction.session_hash } : undefined, preceding, facts);
        if (preceding) await this.db.prepare('DELETE FROM sessions WHERE token=? AND user_id=?').run(preceding.token, preceding.id);
        return this.issue(result.userId, result.identityId, proof.authenticatedAt);
      });
      this.cookies(res, issued);
      res.redirect(303, transaction.return_to);
    }, browserError);
    app.post('/api/identity/reauth', rateLimit, accountLimit, async (req, res) => res.json({ url: await this.start(req, res, 'reauth') }));
    app.post('/api/identity/link', rateLimit, accountLimit, async (req, res) => res.json({ url: await this.start(req, res, 'link') }));
    app.post('/api/identity/legacy-link', rateLimit, async (req, res) => {
      if (!this.settings.legacyLinkUntil || await this.now() >= this.settings.legacyLinkUntil) throw new HttpError(403, 'Legacy account migration is not available.');
      const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128), provider: z.enum(['email', 'google', 'github']), returnTo: z.string().optional() }).safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, 'Enter a valid legacy email, password and sign-in provider.');
      const body = parsed.data;
      await this.limits.enforce('legacy-account', body.email.toLowerCase(), res);
      const row = await this.db.prepare('SELECT u.id,u.password FROM users u LEFT JOIN managed_accounts a ON a.user_id=u.id WHERE u.email=? AND u.demo=0 AND a.user_id IS NULL').get(body.email.toLowerCase());
      const credential = z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/).parse(row?.password ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`);
      const [salt, stored] = credential.split(':');
      const valid = timingSafeEqual(scryptSync(body.password, salt, 64), Buffer.from(stored, 'hex'));
      if (!row?.password || !valid) throw new HttpError(401, 'The legacy email or password is incorrect.');
      res.json({ url: await this.start(req, res, 'legacy-link', String(row.id), hash(credential)) });
    });
    app.get('/api/identity/security', async (req, res) => {
      const session = await this.requireSession(req), now = await this.now();
      const identitySchema = z.object({ id: z.string(), provider: z.enum(['email', 'google', 'github']), email: z.string().nullable(), verified: z.number(), available: z.number(), created_at: z.date() });
      const identities = (await this.db.prepare('SELECT id,provider,email,verified,available,created_at FROM managed_identities WHERE user_id=? ORDER BY created_at,id LIMIT 20').all(session.id)).map(value => {
        const row = identitySchema.parse(value);
        return { id: row.id, provider: row.provider, email: row.email, verified: row.verified === 1, available: row.available === 1, createdAt: row.created_at.toISOString(), current: row.id === session.identity_id };
      });
      const sessions = await this.db.prepare('SELECT m.id,m.created_at,m.last_used,m.authenticated_at FROM managed_sessions m JOIN sessions s ON s.token=m.token WHERE s.user_id=? AND s.expires>? AND m.last_used>? AND m.epoch=? ORDER BY m.created_at DESC LIMIT 50').all(session.id, now, now - idle, session.epoch);
      const events = (await this.db.prepare('SELECT id,action,created_at FROM identity_security_events WHERE user_id=? ORDER BY created_at DESC,id LIMIT 20').all(session.id)).map(value => {
        const row = z.object({ id: z.string(), action: z.string(), created_at: z.date() }).parse(value);
        return { id: row.id, action: row.action, createdAt: row.created_at.toISOString() };
      });
      res.json({
        identities, sessions: sessions.map(value => {
          const row = z.object({ id: z.string(), created_at: z.coerce.number(), last_used: z.coerce.number(), authenticated_at: z.coerce.number() }).parse(value);
          return { id: row.id, createdAt: row.created_at, lastUsed: row.last_used, authenticatedAt: row.authenticated_at, current: row.id === session.session_id };
        }), events, fresh: now - session.authenticated_at <= freshness,
      });
    });
    app.delete('/api/identity/sessions/:id', rateLimit, accountLimit, async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') throw new HttpError(400, 'Choose one session to revoke.');
      const session = await this.requireSession(req, true);
      await this.db.transaction(async () => {
        await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(session.id);
        await this.requireSession(req, true);
        const result = await this.db.prepare('DELETE FROM sessions s USING managed_sessions m WHERE m.token=s.token AND m.id=? AND s.user_id=?').run(id, session.id);
        if (!result) throw new HttpError(404, 'Session not found.');
        await this.audit(session.id, 'session-revoked');
      });
      res.json({ ok: true });
    });
    app.post('/api/identity/sessions/revoke-others', rateLimit, accountLimit, async (req, res) => {
      const session = await this.requireSession(req, true);
      await this.db.transaction(async () => {
        await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(session.id);
        await this.requireSession(req, true);
        await this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(session.id, session.token);
        await this.audit(session.id, 'other-sessions-revoked');
      });
      res.json({ ok: true });
    });
    app.delete('/api/identity/methods/:id', rateLimit, accountLimit, async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') throw new HttpError(400, 'Choose one sign-in method to remove.');
      const session = await this.requireSession(req, true);
      await this.db.transaction(async () => {
        const method = await this.db.prepare('SELECT issuer,subject FROM managed_identities WHERE id=? AND user_id=?').get(id, session.id);
        if (!method) throw new HttpError(404, 'Sign-in method not found.');
        await lockSubject(this.db, z.string().parse(method.issuer), z.string().parse(method.subject));
        await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(session.id);
        await this.requireSession(req, true);
        const identities = await this.db.prepare('SELECT id,verified,email,available FROM managed_identities WHERE user_id=?').all(session.id);
        if (!identities.some(identity => identity.id === id)) throw new HttpError(404, 'Sign-in method not found.');
        if (id === session.identity_id || !identities.some(identity => identity.id !== id && identity.verified === 1 && identity.available === 1)) throw new HttpError(409, 'Keep another available verified sign-in method and confirm with it before removing this one.');
        const account = await this.db.prepare('SELECT contact_identity_id FROM managed_accounts WHERE user_id=?').get(session.id);
        if (account?.contact_identity_id === id) {
          const current = identities.find(identity => identity.id === session.identity_id);
          if (current?.verified !== 1 || typeof current.email !== 'string') throw new HttpError(409, 'Confirm with another verified contact method before removing your current contact source.');
          await this.db.prepare('UPDATE managed_accounts SET contact_identity_id=?,contact_email=?,contact_verified=1,session_epoch=session_epoch+1 WHERE user_id=?').run(session.identity_id, current.email, session.id);
          await this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(session.id, session.token);
          await this.db.prepare('UPDATE managed_sessions SET epoch=epoch+1 WHERE token=?').run(session.token);
        }
        await this.db.prepare('DELETE FROM sessions s USING managed_sessions m WHERE m.token=s.token AND m.identity_id=? AND s.user_id=?').run(id, session.id);
        await this.db.prepare('DELETE FROM managed_identities WHERE id=? AND user_id=?').run(id, session.id);
        await this.audit(session.id, 'identity-unlinked', id);
      });
      res.json({ ok: true });
    });
  }
  async logout(req: express.Request, res: express.Response) {
    const session = await this.session(req), binding = cookie(req, cookieNames.binding);
    await this.db.transaction(async () => {
      if (session) {
        await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(session.id);
        await this.db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);
        await this.audit(session.id, 'logout');
      }
      if (binding) await this.db.prepare('DELETE FROM auth_transactions WHERE binding_hash=?').run(hash(binding));
    });
    for (const name of Object.values(cookieNames)) res.clearCookie(name, cookieOptions);
    res.json({ ok: true });
  }
}
