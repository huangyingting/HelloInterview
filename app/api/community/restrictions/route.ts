import { communityRestrictionStatus } from '../../../../server/next/community';
import { queryInput, routeError } from '../../../../server/next/response';

export async function GET(request: Request) {
  try {
    if (Object.keys(queryInput(request.url)).length) {
      return Response.json({ error: 'Community restriction status does not accept query parameters.' }, { status: 400 });
    }
    return Response.json(await communityRestrictionStatus(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.restriction-status.failed');
  }
}
