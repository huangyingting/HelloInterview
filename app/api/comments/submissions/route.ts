import {
  communityCommentSubmissionHistory,
  createCommunityCommentSubmission,
} from '../../../../server/next/community';
import { queryInput, readJson, routeError } from '../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await createCommunityCommentSubmission(request, await readJson(request, 8192)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.comment-submission-create.failed');
  }
}

export async function GET(request: Request) {
  try {
    return Response.json(await communityCommentSubmissionHistory(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.comment-submission-history.failed');
  }
}
