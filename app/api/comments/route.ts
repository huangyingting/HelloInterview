import { discussionComments } from '../../../server/next/community';
import { queryInput, routeError } from '../../../server/next/response';

export async function GET(request: Request) {
  try {
    const query = queryInput(request.url);
    if (Object.keys(query).some(key => key !== 'resource')) return Response.json({ error: 'Invalid Comment resource.' }, { status: 400 });
    return Response.json(await discussionComments(query.resource), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) { return routeError(error, 'community.comments.failed'); }
}
