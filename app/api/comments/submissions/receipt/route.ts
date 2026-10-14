import { communityCommentSubmission } from '../../../../../server/next/community';
import { queryInput, routeError } from '../../../../../server/next/response';

export async function GET(request: Request) {
  try {
    return Response.json(await communityCommentSubmission(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.comment-submission-receipt.failed');
  }
}
