import { setCommunityPostAction } from '../../../../server/next/community';
import { readJson, routeError } from '../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await setCommunityPostAction(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.post-action.failed');
  }
}
