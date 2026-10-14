import {
  deleteOwnedCommunityPost,
  ownedCommunityPost,
  updateOwnedCommunityPost,
} from '../../../../server/next/community';
import { queryInput, readJson, routeError } from '../../../../server/next/response';

export async function GET(request: Request) {
  try {
    return Response.json(await ownedCommunityPost(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.owned-post-read.failed');
  }
}

export async function PUT(request: Request) {
  try {
    return Response.json(await updateOwnedCommunityPost(request, await readJson(request, 16384)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.owned-post-update.failed');
  }
}

export async function DELETE(request: Request) {
  try {
    return Response.json(await deleteOwnedCommunityPost(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.owned-post-delete.failed');
  }
}
