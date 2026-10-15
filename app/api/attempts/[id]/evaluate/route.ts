import { evaluateAttempt } from '../../../../../server/next/learning';
import { enqueueManagedAi, nextAiCapability } from '../../../../../server/next/ai';
import { readJson, routeError } from '../../../../../server/next/response';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = await readJson(request, 1024);
    const managed = nextAiCapability();
    const result = managed
      ? await enqueueManagedAi(request, 'feedback', id, input)
      : await evaluateAttempt(request, id, input);
    return Response.json(result, {
      status: managed ? 202 : 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.attempt-evaluate.failed');
  }
}
