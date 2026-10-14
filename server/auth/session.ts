import { getServerSession } from 'next-auth';
import type { User } from '../../shared/types';
import { managedAuthSession, type ManagedAuthSession } from './adapter';
import { authCookieNames, loadAuthSettings } from './config';
import { prismaConnection } from '../db/prisma';
import { createAuthOptions } from './options';

function exactCookie(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '').split(';')
    .map(value => value.trim())
    .filter(value => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

export async function currentManagedAuthSession(request: Request, touch = true): Promise<ManagedAuthSession | null> {
  const settings = loadAuthSettings();
  if (!settings) return null;
  const token = exactCookie(request, authCookieNames(settings).session);
  return token ? managedAuthSession(token, touch) : null;
}

function studioUser(row: Record<string, unknown>): User | null {
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.status !== 'string') return null;
  return {
    id: row.id,
    name: row.name,
    email: typeof row.contact_email === 'string' ? row.contact_email : '',
    demo: false,
    identity: {
      status: row.status as NonNullable<User['identity']>['status'],
      verified: row.contact_verified === 1,
    },
  };
}

export function authUserFromManagedSession(session: ManagedAuthSession): User {
  return {
    id: session.userId,
    name: session.user.name ?? 'Studio participant',
    email: session.user.email,
    demo: false,
    identity: {
      status: session.status as NonNullable<User['identity']>['status'],
      verified: session.user.emailVerified !== null,
    },
  };
}

export async function currentAuthUser(request?: Request): Promise<User | null> {
  const settings = loadAuthSettings();
  if (!settings) return null;
  if (request) {
    const managed = await currentManagedAuthSession(request);
    return managed ? authUserFromManagedSession(managed) : null;
  }
  const id = (await getServerSession(createAuthOptions()))?.user?.id;
  if (!id) return null;
  const rows = await prismaConnection().executeSql(`
    SELECT u.id,u.name,a.contact_email,a.contact_verified,a.status
    FROM users u JOIN managed_accounts a ON a.user_id=u.id
    WHERE u.id=$1
  `, [id]);
  const row = rows.rows[0];
  return row ? studioUser(row) : null;
}
