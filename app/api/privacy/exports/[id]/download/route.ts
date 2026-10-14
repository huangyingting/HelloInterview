import { downloadPrivacyExport } from '../../../../../../server/next/privacy';
import { routeError } from '../../../../../../server/next/response';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const result = await downloadPrivacyExport(request, (await context.params).id);
    return new Response(result.artifact, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="interview-studio-owner-export-${result.status.id}.json"`,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return routeError(error, 'privacy.export-download.failed');
  }
}
