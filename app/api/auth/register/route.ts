import { enforcePublicAuthRateLimit } from '../../../../server/account-admission/guard';
import { getAccountAdmissionMode } from '../../../../server/account-admission/policy';
import {
  registerInInvitationMode,
  registerInPublicMode,
} from '../../../../server/account-admission/registration';
import { applySessionCookies } from '../../../../server/account-admission/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rateLimited = await enforcePublicAuthRateLimit(request, 'auth-register');
  if (rateLimited) return rateLimited;

  let body: {
    token?: unknown;
    email?: unknown;
    password?: unknown;
    name?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name : null;
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const mode = getAccountAdmissionMode();

  if (mode === 'invitation-only' || token.length > 0) {
    if (!token) {
      return Response.json(
        {
          error: 'invitation_required',
          message: 'Registration requires a valid administrator invitation.',
        },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const result = await registerInInvitationMode({
      token,
      email,
      password,
      name,
    });
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
        mode: 'invitation-only',
        authenticated: true,
        user: result.user,
      },
      { status: 201, headers },
    );
  }

  const publicResult = await registerInPublicMode({
    email,
    password,
    name,
  });
  if (!publicResult.ok) {
    return Response.json(
      { error: publicResult.code, message: publicResult.message },
      { status: publicResult.status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return Response.json(
    {
      ok: true,
      mode: 'public',
      authenticated: false,
      message: publicResult.message,
    },
    { status: publicResult.status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
