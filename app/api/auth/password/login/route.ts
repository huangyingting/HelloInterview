import { authenticateWithPassword } from '../../../../../server/account-admission/credentials';
import { enforcePublicAuthRateLimit } from '../../../../../server/account-admission/guard';
import { applySessionCookies } from '../../../../../server/account-admission/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rateLimited = await enforcePublicAuthRateLimit(request, 'auth-password-login');
  if (rateLimited) return rateLimited;

  let body: { email?: unknown; password?: unknown } = {};
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const result = await authenticateWithPassword({ email, password });
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
      user: result.user,
    },
    { status: 200, headers },
  );
}
