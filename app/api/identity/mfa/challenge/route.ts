import { completeMfaChallenge } from '../../../../../server/next/mfa';
import { readJson, routeError } from '../../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await completeMfaChallenge(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'identity.mfa-challenge.failed');
  }
}
