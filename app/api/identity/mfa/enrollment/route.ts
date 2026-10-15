import { beginTotpEnrollment } from '../../../../../server/next/mfa';
import { routeError } from '../../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await beginTotpEnrollment(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'identity.mfa-enrollment-start.failed');
  }
}
