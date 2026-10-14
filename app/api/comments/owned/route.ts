import {
  deleteOwnedCommunityComment,
  ownedCommunityComment,
  updateOwnedCommunityComment,
} from '../../../../server/next/community';
import { queryInput, readJson, routeError } from '../../../../server/next/response';

export async function GET(request: Request) {
  try {
    return Response.json(await ownedCommunityComment(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.owned-comment-read.failed');
  }
}

export async function PUT(request: Request) {
  try {
    return Response.json(await updateOwnedCommunityComment(request, await readJson(request, 8192)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.owned-comment-update.failed');
  }
}

export async function DELETE(request: Request) {
  try {
    return Response.json(await deleteOwnedCommunityComment(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.owned-comment-delete.failed');
  }
}
