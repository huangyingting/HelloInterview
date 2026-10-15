import { billingView } from '../../../server/next/billing';
import { routeError } from '../../../server/next/response';

export async function GET(request: Request) {
  try {
    return Response.json(await billingView(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'billing.view.failed');
  }
}
