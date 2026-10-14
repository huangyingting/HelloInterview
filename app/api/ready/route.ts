import { prismaConnection } from '../../../server/db/prisma';
import { assertDatabaseVersion } from '../../../server/db/migrations';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = prismaConnection();
    await assertDatabaseVersion(db);
    await db.prepare('SELECT 1 AS healthy').get();
    return Response.json({ status: 'ready', mode: 'service' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'readiness.failed', reason: error instanceof Error ? error.name : 'unknown' }));
    return Response.json({ error: 'The Studio is not ready. Try again later.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
