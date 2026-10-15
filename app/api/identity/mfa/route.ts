import { disableTotp } from '../../../../server/next/mfa';
import { routeError } from '../../../../server/next/response';

export async function DELETE(request: Request) {
  try {
    return Response.json(await disableTotp(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'identity.mfa-disable.failed');
  }
}
