import { enforcePublicAuthRateLimit } from '../../../../server/account-admission/guard';
import { verifyPendingRegistrationToken } from '../../../../server/account-admission/registration';
import { applySessionCookies } from '../../../../server/account-admission/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rateLimited = await enforcePublicAuthRateLimit(request, 'auth-verify-email');
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
  const result = await verifyPendingRegistrationToken({ token });
  if (!result.ok) {
    return Response.json(
      { error: result.code, message: result.message },
      { status: result.status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  applySessionCookies(headers, result.session);
  return Response.json(
    {
      ok: true,
      authenticated: true,
      user: result.user,
    },
    { status: 200, headers },
  );
}
