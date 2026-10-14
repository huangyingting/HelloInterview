import { supportHistory } from '../../../../server/next/support';
import { queryInput, routeError } from '../../../../server/next/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const query = queryInput(request.url);
    if (Object.keys(query).some(key => key !== 'cursor') || Array.isArray(query.cursor)) {
      return Response.json({ error: 'Use only a single owned support cursor.' }, { status: 400 });
    }
    return Response.json(await supportHistory(request, query.cursor), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'support.request-history.failed');
  }
}
