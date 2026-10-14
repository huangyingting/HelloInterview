import { enrollCourse } from '../../../../../server/next/learning';
import { readJson, routeError } from '../../../../../server/next/response';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(await enrollCourse(request, id, await readJson(request, 1024)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.course-enroll.failed');
  }
}
