import { cancelPrivacyDeletion } from '../../../../../server/next/privacy';
import { readJson, routeError } from '../../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await cancelPrivacyDeletion(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'privacy.deletion-cancel.failed');
  }
}
