import { getServerSession } from 'next-auth';
import { emptyState } from '../../../shared/domain';
import type { User } from '../../../shared/types';
import { createAuthOptions } from '../../../server/auth/options';
import { loadAuthSettings } from '../../../server/auth/config';
import { prismaConnection } from '../../../server/db/prisma';
import { StateRepository } from '../../../server/db/state-repository';
import { Entitlements } from '../../../server/entitlements';

export const dynamic = 'force-dynamic';

async function currentUser(): Promise<User | null> {
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

export async function GET() {
  try {
    const db = prismaConnection();
    const user = await currentUser();
    const active = user?.identity?.status === 'active';
    const [state, access] = await Promise.all([
      user && active ? new StateRepository(db).read(user.id) : Promise.resolve(emptyState()),
      new Entitlements(db).view(user?.id ?? null),
    ]);
    return Response.json({
      user,
      state,
      capabilities: {
        ai: false,
        commerce: 'disabled',
        community: 'read-only',
        aiModel: null,
        fieldMetrics: false,
        auth: {
          mode: 'managed',
          system: 'authjs',
          providers: ['google', 'facebook'],
          legacyLink: false,
          securityLifecycle: false,
        },
        access,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'bootstrap.failed', reason: error instanceof Error ? error.name : 'unknown' }));
    return Response.json({ error: 'The Studio is unavailable. Try again later.' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
