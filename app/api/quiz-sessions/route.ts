import { createQuizSession, listQuizSessions } from '../../../server/next/learning';
import { readJson, routeError } from '../../../server/next/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return Response.json(await listQuizSessions(request), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.quiz-session-list.failed');
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await createQuizSession(request, await readJson(request, 4096)), {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'learning.quiz-session-create.failed');
  }
}
