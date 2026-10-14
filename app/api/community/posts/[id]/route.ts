import { communityPathDetail } from '../../../../../server/next/community';
import { queryInput, routeError } from '../../../../../server/next/response';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await communityPathDetail((await context.params).id, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) { return routeError(error, 'community.path-detail.failed'); }
}
