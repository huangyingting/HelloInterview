import { askTutor, clearTutor } from '../../../server/next/learning';
import { readJson, routeError } from '../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await askTutor(request, await readJson(request, 8192)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.tutor-ask.failed');
  }
}

export async function DELETE(request: Request) {
  try {
    return Response.json(await clearTutor(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.tutor-clear.failed');
  }
}
