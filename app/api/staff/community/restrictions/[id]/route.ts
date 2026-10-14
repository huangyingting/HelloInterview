import { changeStaffRestriction } from '../../../../../../server/next/staff';
import { readJson, routeError } from '../../../../../../server/next/response';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(await changeStaffRestriction(request, id, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'staff.community-restriction-change.failed');
  }
}
