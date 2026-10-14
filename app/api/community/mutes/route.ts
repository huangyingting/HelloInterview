import { communityMuteHistory, setCommunityMute } from '../../../../server/next/community';
import { queryInput, readJson, routeError } from '../../../../server/next/response';

export async function PUT(request: Request) {
  try {
    return Response.json(await setCommunityMute(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.mute-save.failed');
  }
}

export async function GET(request: Request) {
  try {
    return Response.json(await communityMuteHistory(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.mute-history.failed');
  }
}
