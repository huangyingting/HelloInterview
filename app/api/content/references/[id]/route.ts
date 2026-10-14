import { referenceContent } from '../../../../../server/next/content';
import { routeError } from '../../../../../server/next/response';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await referenceContent(id);
    return Response.json(result.value, {
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Version': result.version },
    });
  } catch (error) { return routeError(error, 'content.reference.failed'); }
}
