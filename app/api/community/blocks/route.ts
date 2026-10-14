import { communityBlockHistory, setCommunityBlock } from '../../../../server/next/community';
import { queryInput, readJson, routeError } from '../../../../server/next/response';

export async function PUT(request: Request) {
  try {
    return Response.json(await setCommunityBlock(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.block-save.failed');
  }
}

export async function GET(request: Request) {
  try {
    return Response.json(await communityBlockHistory(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.block-history.failed');
  }
}
