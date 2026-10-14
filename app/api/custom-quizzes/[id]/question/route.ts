import { customQuizQuestion } from '../../../../../server/next/learning';
import { routeError } from '../../../../../server/next/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(await customQuizQuestion(request, id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.custom-quiz-question.failed');
  }
}
