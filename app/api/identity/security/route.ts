import { identitySecurity } from '../../../../server/next/identity';
import { routeError } from '../../../../server/next/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return Response.json(await identitySecurity(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'identity.security.failed');
  }
}
