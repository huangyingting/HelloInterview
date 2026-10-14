import { savePlanReflection } from '../../../../../server/next/learning';
import { readJson, routeError } from '../../../../../server/next/response';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(await savePlanReflection(request, id, await readJson(request, 8192)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.study-plan-reflection.failed');
  }
}
