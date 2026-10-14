import { saveSupportRequest } from '../../../server/next/support';
import { readJson, routeError } from '../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await saveSupportRequest(request, await readJson(request, 12288)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'support.request-save.failed');
  }
}
