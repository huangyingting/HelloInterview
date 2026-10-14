import { legacyPosts } from '../../../server/next/community';
import { queryInput, routeError } from '../../../server/next/response';

export async function GET(request: Request) {
  try {
    const query = queryInput(request.url);
    if (Object.keys(query).some(key => key !== 'kind')) return Response.json({ error: 'Choose a supported community section.' }, { status: 400 });
    const result = await legacyPosts(query.kind);
    return Response.json(result.posts, {
      headers: { 'Cache-Control': 'private, no-store', 'X-Community-Truncated': String(result.truncated) },
    });
  } catch (error) { return routeError(error, 'community.legacy.failed'); }
}
