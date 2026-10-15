import { emptyState } from '../../../shared/domain';
import { issueCsrf } from '../../../server/auth/csrf';
import { authUserFromManagedSession, currentManagedAuthSession } from '../../../server/auth/session';
import { prismaConnection } from '../../../server/db/prisma';
import { StateRepository } from '../../../server/db/state-repository';
import { Entitlements } from '../../../server/entitlements';
import { nextBillingCapability } from '../../../server/next/billing';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const db = prismaConnection();
    const session = await currentManagedAuthSession(request);
    const user = session ? authUserFromManagedSession(session) : null;
    const csrf = await issueCsrf(request, session);
    const active = user?.identity?.status === 'active';
    const billing = nextBillingCapability();
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
        ...(billing ? { billing } : {}),
        access,
      },
      csrf: csrf.token,
    }, {
      headers: {
        'Cache-Control': 'private, no-store',
        ...(csrf.cookie ? { 'Set-Cookie': csrf.cookie } : {}),
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'bootstrap.failed', reason: error instanceof Error ? error.name : 'unknown' }));
    return Response.json({ error: 'The Studio is unavailable. Try again later.' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
