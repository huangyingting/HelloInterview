import { staffRestrictionAppealQueue } from '../../../../../server/next/staff';
import { queryInput, routeError } from '../../../../../server/next/response';

export async function GET(request: Request) {
  try {
    return Response.json(await staffRestrictionAppealQueue(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'staff.community-restriction-appeal-queue.failed');
  }
}
