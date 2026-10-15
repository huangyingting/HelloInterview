import { resetPasswordWithToken } from '../../../../../server/account-admission/credentials';
import { enforcePublicAuthRateLimit } from '../../../../../server/account-admission/guard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rateLimited = await enforcePublicAuthRateLimit(request, 'auth-password-reset');
  if (rateLimited) return rateLimited;

  let body: { token?: unknown; password?: unknown } = {};
  try {
    body = (await request.json()) as { token?: unknown; password?: unknown };
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const result = await resetPasswordWithToken({ token, password });
  if (!result.ok) {
    return Response.json(
      { error: result.code, message: result.message },
      { status: result.status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return Response.json(
    { ok: true, message: 'Your password has been updated. Please sign in.' },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
