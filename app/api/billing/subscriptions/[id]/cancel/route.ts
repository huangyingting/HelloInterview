import { cancelSubscription } from '../../../../../../server/next/billing';
import { readJson, routeError } from '../../../../../../server/next/response';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await cancelSubscription(
      request,
      (await context.params).id,
      await readJson(request, 4096),
    ), {
      status: 202,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'billing.subscription-cancel.failed');
  }
}
