import { saveStory } from '../../../server/next/learning';
import { readJson, routeError } from '../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await saveStory(request, await readJson(request, 24576)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.story-save.failed');
  }
}
