import { privacyDeletion, requestPrivacyDeletion } from '../../../../server/next/privacy';
import { readJson, routeError } from '../../../../server/next/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return Response.json(await privacyDeletion(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'privacy.deletion-status.failed');
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await requestPrivacyDeletion(request, await readJson(request, 4096)), {
      status: 202,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'privacy.deletion-request.failed');
  }
}
