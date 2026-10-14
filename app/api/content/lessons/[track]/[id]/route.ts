import { lessonContent } from '../../../../../../server/next/content';
import { routeError } from '../../../../../../server/next/response';

export async function GET(request: Request, context: { params: Promise<{ track: string; id: string }> }) {
  try {
    const { track, id } = await context.params;
    const result = await lessonContent(request, track, id);
    return Response.json(result.value, {
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Version': result.version },
    });
  } catch (error) { return routeError(error, 'content.lesson.failed'); }
}
