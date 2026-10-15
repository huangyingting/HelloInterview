import { openBillingPortal } from '../../../../server/next/billing';
import { readJson, routeError } from '../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await openBillingPortal(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'billing.portal.failed');
  }
}
