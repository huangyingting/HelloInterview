import { cancelManagedAiOperation, managedAiOperation } from '../../../../../server/next/ai';
import { routeError } from '../../../../../server/next/response';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await managedAiOperation(request, (await context.params).id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'managed-ai.operation-read.failed');
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await cancelManagedAiOperation(request, (await context.params).id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'managed-ai.operation-cancel.failed');
  }
}
