import { saveMockDraft } from '../../../../../server/next/learning';
import { readJson, routeError } from '../../../../../server/next/response';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(await saveMockDraft(request, id, await readJson(request, 12288)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.mock-draft.failed');
  }
}
