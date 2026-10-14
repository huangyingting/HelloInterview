import { createCommunityPost, legacyPosts } from '../../../server/next/community';
import { queryInput, readJson, routeError } from '../../../server/next/response';

export async function GET(request: Request) {
  try {
    const query = queryInput(request.url);
    if (Object.keys(query).some(key => key !== 'kind')) return Response.json({ error: 'Choose a supported community section.' }, { status: 400 });
    const result = await legacyPosts(request, query.kind);
    return Response.json(result.posts, {
      headers: { 'Cache-Control': 'private, no-store', 'X-Community-Truncated': String(result.truncated) },
    });
  } catch (error) { return routeError(error, 'community.legacy.failed'); }
}

export async function POST(request: Request) {
  try {
    return Response.json(await createCommunityPost(request, await readJson(request, 16384)), {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.post-create.failed');
  }
}
