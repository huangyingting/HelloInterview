import { inspectInvitationToken } from '../../../../server/account-admission/invitations';
import { enforcePublicAuthRateLimit } from '../../../../server/account-admission/guard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rateLimited = await enforcePublicAuthRateLimit(request, 'auth-invitation-inspect');
  if (rateLimited) return rateLimited;

  let body: { token?: unknown } = {};
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const result = await inspectInvitationToken(token);
  return Response.json(
    { invitation: result },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
