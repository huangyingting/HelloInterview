import { getServerSession } from 'next-auth';
import type { User } from '../../shared/types';
import { prismaConnection } from '../db/prisma';
import { loadAuthSettings } from './config';
import { createAuthOptions } from './options';

export async function currentAuthUser(): Promise<User | null> {
  if (!loadAuthSettings()) return null;
  const session = await getServerSession(createAuthOptions());
  const id = session?.user?.id;
  if (!id) return null;
  const rows = await prismaConnection().executeSql(`
    SELECT u.id,u.name,a.contact_email,a.contact_verified,a.status
    FROM users u JOIN managed_accounts a ON a.user_id=u.id
    WHERE u.id=$1
  `, [id]);
  const row = rows.rows[0];
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.status !== 'string') return null;
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
