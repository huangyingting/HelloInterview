import { communityDetail } from '../../../../server/next/community';
import { queryInput, routeError } from '../../../../server/next/response';

export async function GET(request: Request) {
  try {
    return Response.json(await communityDetail(queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) { return routeError(error, 'community.detail.failed'); }
}
