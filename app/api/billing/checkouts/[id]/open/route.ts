import { useCheckout } from '../../../../../../server/next/billing';
import { readJson, routeError } from '../../../../../../server/next/response';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await useCheckout(
      request,
      (await context.params).id,
      await readJson(request, 4096),
      'open',
    ), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'billing.checkout-open.failed');
  }
}
