import type { StaffRole, User } from '../../shared/types';
import { loadAuthSettings } from '../auth/config';
import { assertCsrf } from '../auth/csrf';
import { currentManagedAuthSession } from '../auth/session';
import { CommunityModeration } from '../community-moderation';
import { CommunityRestrictions } from '../community-restrictions';
import type { Database } from '../db/connection';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { IdentityLimits } from '../identity/limits';
import { StaffAdministration, staffRoleSchema, type StaffIdentityAuthority } from '../staff';
import { SupportRequests, type SupportIdentityAuthority } from '../support';

const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const freshness = 10 * 60000;
const staffSessionLifetime = 12 * 60 * 60000;
const staffIdle = 30 * 60000;

async function enforceStaffLimit(db: Database, owner: string) {
  const settings = loadAuthSettings();
  if (!settings) throw new HttpError(503, 'Authentication is not configured.');
  const decision = await new IdentityLimits(db, settings.secret).consume('account-security', owner);
  if (!decision.allowed) {
    throw new HttpError(429, 'Too many staff verification attempts. Wait for the shared 15-minute attempt window before trying again.', {
      'Retry-After': String(decision.retryAfter),
    });
  }
}

export async function currentStaffRoles(db: Database, owner: string): Promise<StaffRole[]> {
  const rows = await db.prepare(`SELECT role FROM (
    SELECT DISTINCT ON (role) role,state,starts_at,ends_at FROM staff_role_events
    WHERE user_id=? ORDER BY role,created_at DESC,id DESC
  ) latest WHERE state='granted' AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp() ORDER BY role`).all(owner);
  return rows.map(row => staffRoleSchema.parse(row.role));
}

async function staffContext(request: Request, mutation = false) {
  const session = await currentManagedAuthSession(request, false);
  if (!session) throw new HttpError(401, 'Sign in before opening staff operations.');
  if (mutation) assertCsrf(request, session);
  const db = prismaConnection();
  await enforceStaffLimit(db, session.userId);
  const saved = await db.prepare('SELECT name FROM users WHERE id=?').get(session.userId);
  if (typeof saved?.name !== 'string') throw new HttpError(401, 'Sign in again before opening staff operations.');
  const user: User = {
    id: session.userId,
    name: saved.name,
    email: session.user.email ?? '',
    demo: false,
    identity: { status: 'active', verified: true },
  };
  const roles = (owner: string): Promise<StaffRole[]> => currentStaffRoles(db, owner);
  const authority: StaffIdentityAuthority & SupportIdentityAuthority = {
    assertDatabase(candidate) {
      if (candidate !== db) throw new Error('Staff services and session authority must share the exact database adapter.');
    },
    async assertStaff(candidate) {
      if (candidate !== user) throw new HttpError(401, 'Sign in again before using staff administration.');
      await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(session.userId);
      const row = await db.prepare(`
        SELECT a.status
        FROM managed_accounts a
        JOIN sessions s ON s.user_id=a.user_id
        JOIN managed_sessions m ON m.token=s.token
        JOIN managed_identities i ON i.id=m.identity_id AND i.user_id=a.user_id
        JOIN managed_totp_credentials t ON t.user_id=a.user_id AND t.status='active'
        WHERE a.user_id=? AND s.token=? AND a.status='active' AND a.contact_verified=1
          AND a.session_epoch=m.epoch AND s.expires>${clock}
          AND m.last_used>${clock}-? AND m.created_at>${clock}-?
          AND m.authenticated_at>${clock}-? AND m.mfa_at>${clock}-?
          AND i.available=1 AND m.authenticated_at>a.security_cutoff
        FOR UPDATE OF a,s,m,i,t
      `).get(session.userId, session.tokenHash, staffIdle, staffSessionLifetime, freshness, freshness);
      if (!row) {
        throw new HttpError(403, 'Staff actions require an active account, verified MFA and a fresh sign-in. Confirm your identity again.');
      }
      await db.prepare(`UPDATE managed_sessions SET last_used=${clock} WHERE token=?`).run(session.tokenHash);
    },
    staffRoles: roles,
    async assertSupport(candidate) {
      await this.assertStaff(candidate);
    },
  };
  return {
    user,
    staff: new StaffAdministration(db, authority),
    support: new SupportRequests(db, authority),
    moderation: new CommunityModeration(db, authority),
    restrictions: new CommunityRestrictions(db, authority),
  };
}

export async function staffSession(request: Request) {
  const { staff, user } = await staffContext(request);
  return staff.session(user);
}

export async function staffAccountLookup(request: Request, input: unknown) {
  const { staff, user } = await staffContext(request);
  return staff.lookup(user, input);
}

export async function staffAuditHistory(request: Request, input: unknown) {
  const { staff, user } = await staffContext(request);
  return staff.history(user, input);
}

export async function staffSupportQueue(request: Request, input: unknown) {
  const { support, user } = await staffContext(request);
  return support.queue(user, input);
}

export async function staffModerationQueue(request: Request, input: unknown) {
  const { moderation, user } = await staffContext(request);
  return moderation.queue(user, input);
}

export async function staffModerationAppealQueue(request: Request, input: unknown) {
  const { moderation, user } = await staffContext(request);
  return moderation.appealQueue(user, input);
}

export async function staffRestrictionQueue(request: Request, input: unknown) {
  const { restrictions, user } = await staffContext(request);
  return restrictions.queue(user, input);
}

export async function staffRestrictionAppealQueue(request: Request, input: unknown) {
  const { restrictions, user } = await staffContext(request);
  return restrictions.appealQueue(user, input);
}

export async function changeStaffAccountStatus(request: Request, id: string, input: unknown) {
  const { staff, user } = await staffContext(request, true);
  return staff.changeStatus(user, id, input);
}

export async function updateStaffSupport(request: Request, id: string, input: unknown) {
  const { support, user } = await staffContext(request, true);
  return support.update(user, id, input);
}

export async function replyToStaffSupport(request: Request, id: string, input: unknown) {
  const { support, user } = await staffContext(request, true);
  return support.respond(user, id, input);
}

export async function actOnStaffReport(request: Request, id: string, input: unknown) {
  const { moderation, user } = await staffContext(request, true);
  return moderation.act(user, id, input);
}

export async function reviewStaffReportTriage(request: Request, id: string, input: unknown) {
  const { moderation, user } = await staffContext(request, true);
  return moderation.reviewTriage(user, id, input);
}

export async function applyStaffRestriction(request: Request, id: string, input: unknown) {
  const { restrictions, user } = await staffContext(request, true);
  return restrictions.apply(user, id, input);
}

export async function changeStaffRestriction(request: Request, id: string, input: unknown) {
  const { restrictions, user } = await staffContext(request, true);
  return restrictions.change(user, id, input);
}

export async function actOnStaffRestrictionAppeal(request: Request, id: string, input: unknown) {
  const { restrictions, user } = await staffContext(request, true);
  return restrictions.actOnAppeal(user, id, input);
}

export async function actOnStaffAppeal(request: Request, id: string, input: unknown) {
  const { moderation, user } = await staffContext(request, true);
  return moderation.actOnAppeal(user, id, input);
}
