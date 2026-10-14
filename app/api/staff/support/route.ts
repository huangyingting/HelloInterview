import { staffSupportQueue } from '../../../../server/next/staff';
import { queryInput, routeError } from '../../../../server/next/response';

export async function GET(request: Request) {
  try {
    return Response.json(await staffSupportQueue(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'staff.support-queue.failed');
  }
}
