import { requestPasswordReset } from '../../../../../server/account-admission/credentials';
import { enforcePublicAuthRateLimit } from '../../../../../server/account-admission/guard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rateLimited = await enforcePublicAuthRateLimit(request, 'auth-password-forgot');
  if (rateLimited) return rateLimited;

  let body: { email?: unknown } = {};
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const email = typeof body.email === 'string' ? body.email : '';
  const result = await requestPasswordReset({ email });
  if (!result.ok) {
    return Response.json(
      { error: result.code, message: result.message },
      { status: result.status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return Response.json(
    { ok: true, message: result.message },
    { status: result.status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
