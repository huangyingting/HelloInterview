import { saveAttempt } from '../../../server/next/learning';
import { readJson, routeError } from '../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await saveAttempt(request, await readJson(request, 131072)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.attempt-save.failed');
  }
}
