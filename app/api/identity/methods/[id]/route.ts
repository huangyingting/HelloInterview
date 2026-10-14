import { removeIdentity } from '../../../../../server/next/identity';
import { routeError } from '../../../../../server/next/response';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    return Response.json(await removeIdentity(request, (await context.params).id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'identity.method-remove.failed');
  }
}
