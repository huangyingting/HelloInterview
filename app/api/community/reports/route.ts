import { communityReportHistory, saveCommunityReport } from '../../../../server/next/community';
import { queryInput, readJson, routeError } from '../../../../server/next/response';

export async function POST(request: Request) {
  try {
    return Response.json(await saveCommunityReport(request, await readJson(request, 4096)), {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.report-save.failed');
  }
}

export async function GET(request: Request) {
  try {
    return Response.json(await communityReportHistory(request, queryInput(request.url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'community.report-history.failed');
  }
}
