import { beginIdentityLink } from '../../../../server/next/identity';
import { readJson, routeError } from '../../../../server/next/response';

export async function POST(request: Request) {
  try {
    const result = await beginIdentityLink(request, await readJson(request, 4096));
    return Response.json({ url: result.url }, {
      headers: { 'Cache-Control': 'private, no-store', 'Set-Cookie': result.cookie },
    });
  } catch (error) {
    return routeError(error, 'identity.link-start.failed');
  }
}
