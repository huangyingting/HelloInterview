import { problemContent } from '../../../../../server/next/content';
import { routeError } from '../../../../../server/next/response';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    if (params.getAll('project').length > 1 || [...params.keys()].some(key => key !== 'project')) {
      return Response.json({ error: 'Invalid project query.' }, { status: 400 });
    }
    const result = await problemContent(request, id, params.get('project'));
    return Response.json(result.value, {
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Version': result.version },
    });
  } catch (error) { return routeError(error, 'content.problem.failed'); }
}
