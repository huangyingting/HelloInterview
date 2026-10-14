import { createCustomQuiz } from '../../../server/next/learning';
import { readJson, routeError } from '../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await createCustomQuiz(request, await readJson(request, 16384)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.custom-quiz-create.failed');
  }
}
