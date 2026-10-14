import {
  communityRestrictionAppealHistory,
  saveCommunityRestrictionAppeal,
} from '../../../../server/next/community';
import { queryInput, readJson, routeError } from '../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await saveCommunityRestrictionAppeal(request, await readJson(request, 4096)), {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.restriction-appeal-save.failed');
  }
}

export async function GET(request: Request) {
  try {
    return Response.json(await communityRestrictionAppealHistory(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.restriction-appeal-history.failed');
  }
}
