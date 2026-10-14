import { randomUUID } from 'node:crypto';
import { assertCsrf } from '../auth/csrf';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { PrivacyExports } from '../privacy';
import { assertAccountSession, requireAccountSession } from './identity';

const freshness = 10 * 60000;
const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
let service: Promise<PrivacyExports> | null = null;

async function privacyService() {
  const pending = service ??= PrivacyExports.open(prismaConnection());
  try {
    return await pending;
  } catch (error) {
    if (service === pending) service = null;
    throw error;
  }
}

export async function closeNextPrivacyService() {
  const current = service;
  service = null;
  if (current) await (await current).close();
}

async function sessionFresh(authenticatedAt: number) {
  const now = Number((await prismaConnection().prepare(`SELECT ${clock} AS now`).get())?.now);
  return now - authenticatedAt <= freshness;
}

export async function requestPrivacyExport(request: Request, input: unknown) {
  const session = await requireAccountSession(request, ['active']);
  assertCsrf(request, session);
  const privacy = await privacyService();
  return privacy.request(session.userId, input,
    () => assertAccountSession(prismaConnection(), session, true, ['active']));
}

export async function privacyExportHistory(request: Request) {
  const session = await requireAccountSession(request, ['active']);
  const db = prismaConnection(), privacy = await privacyService();
  return db.transaction(async () => {
    await assertAccountSession(db, session, false, ['active']);
    const result = await privacy.history(session.userId);
    await assertAccountSession(db, session, false, ['active']);
    return result;
  });
}

export async function downloadPrivacyExport(request: Request, id: string) {
  const session = await requireAccountSession(request, ['active']);
  const db = prismaConnection(), privacy = await privacyService();
  return db.transaction(async () => {
    await assertAccountSession(db, session, true, ['active']);
    const result = await privacy.download(session.userId, id);
    await assertAccountSession(db, session, true, ['active']);
    return result;
  });
}

export async function privacyDeletion(request: Request) {
  const session = await requireAccountSession(request, ['active', 'deletion-pending']);
  return (await privacyService()).deletion(session.userId, await sessionFresh(session.authenticatedAt));
}

export async function requestPrivacyDeletion(request: Request, input: unknown) {
  const session = await requireAccountSession(request, ['active']);
  assertCsrf(request, session);
  const db = prismaConnection(), privacy = await privacyService();
  return privacy.requestDeletion(session.userId, input, mutation => db.transaction(async () => {
    await assertAccountSession(db, session, true, ['active']);
    const result = await mutation();
    const changed = await db.prepare(`
      UPDATE managed_accounts
      SET status='deletion-pending',session_epoch=session_epoch+1,admin_revision=admin_revision+1
      WHERE user_id=? AND status='active'
    `).run(session.userId);
    if (changed !== 1) throw new HttpError(409, 'The account changed before deletion could be requested.');
    await db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(session.userId, session.tokenHash);
    await db.prepare('UPDATE managed_sessions SET epoch=epoch+1 WHERE token=?').run(session.tokenHash);
    await db.prepare('INSERT INTO identity_security_events (id,user_id,action) VALUES (?,?,?)')
      .run(randomUUID(), session.userId, 'deletion-requested');
    return result;
  }));
}

export async function cancelPrivacyDeletion(request: Request, input: unknown) {
  const session = await requireAccountSession(request, ['deletion-pending']);
  assertCsrf(request, session);
  const db = prismaConnection(), privacy = await privacyService();
  return privacy.cancelDeletion(session.userId, input, mutation => db.transaction(async () => {
    await assertAccountSession(db, session, true, ['deletion-pending']);
    const result = await mutation();
    const changed = await db.prepare(`
      UPDATE managed_accounts
      SET status='active',session_epoch=session_epoch+1,admin_revision=admin_revision+1
      WHERE user_id=? AND status='deletion-pending'
    `).run(session.userId);
    if (changed !== 1) throw new HttpError(409, 'The account changed before deletion could be cancelled.');
    await db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(session.userId, session.tokenHash);
    await db.prepare('UPDATE managed_sessions SET epoch=epoch+1 WHERE token=?').run(session.tokenHash);
    await db.prepare('INSERT INTO identity_security_events (id,user_id,action) VALUES (?,?,?)')
      .run(randomUUID(), session.userId, 'deletion-cancelled');
    return result;
  }));
}
