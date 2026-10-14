import { staffSession } from '../../../../server/next/staff';
import { queryInput, routeError } from '../../../../server/next/response';

export async function GET(request: Request) {
  try {
    if (Object.keys(queryInput(request.url)).length) {
      return Response.json({ error: 'Staff session verification does not accept query parameters.' }, { status: 400 });
    }
    return Response.json(await staffSession(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'staff.session.failed');
  }
}
