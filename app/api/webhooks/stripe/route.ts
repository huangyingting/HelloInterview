import { acceptStripeWebhook } from '../../../../server/next/billing';
import { routeError } from '../../../../server/next/response';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    return Response.json(await acceptStripeWebhook(request), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return routeError(error, 'billing.webhook.failed');
  }
}
