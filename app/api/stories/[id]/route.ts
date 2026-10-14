import { deleteStory } from '../../../../server/next/learning';
import { routeError } from '../../../../server/next/response';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(await deleteStory(request, id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.story-delete.failed');
  }
}
