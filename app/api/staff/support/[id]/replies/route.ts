import { replyToStaffSupport } from '../../../../../../server/next/staff';
import { readJson, routeError } from '../../../../../../server/next/response';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(await replyToStaffSupport(request, id, await readJson(request, 16384)), {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'staff.support-reply.failed');
  }
}
