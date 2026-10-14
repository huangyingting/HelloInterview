import { revokeOtherSessions } from '../../../../../server/next/identity';
import { routeError } from '../../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await revokeOtherSessions(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'identity.sessions-revoke-others.failed');
  }
}
