import { reviewStaffReportTriage } from '../../../../../../../server/next/staff';
import { readJson, routeError } from '../../../../../../../server/next/response';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(await reviewStaffReportTriage(request, id, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'staff.community-triage-review.failed');
  }
}
