import { getUserAuthMethods, setUserPassword } from '../../../../server/account-admission/credentials';
import { assertMutationOriginOrCsrf } from '../../../../server/account-admission/guard';
import { currentManagedAuthSession } from '../../../../server/auth/session';
import { HttpError } from '../../../../server/http-error';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await currentManagedAuthSession(request);
  if (!session) {
    return Response.json(
      { error: 'unauthorized', message: 'Authentication required.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  const methods = await getUserAuthMethods(session.userId);
  return Response.json(methods, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function PUT(request: Request) {
  const session = await currentManagedAuthSession(request);
  if (!session) {
    return Response.json(
      { error: 'unauthorized', message: 'Authentication required.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  if (session.status !== 'active') {
    return Response.json(
      { error: 'forbidden', message: 'Only active accounts may change passwords.' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  try {
    assertMutationOriginOrCsrf(request, session);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 403;
    return Response.json(
      {
        error: 'forbidden',
        message: error instanceof Error ? error.message : 'Cross-origin mutation rejected.',
      },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  let body: { currentPassword?: unknown; newPassword?: unknown } = {};
  try {
    body = (await request.json()) as { currentPassword?: unknown; newPassword?: unknown };
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : null;
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  const result = await setUserPassword({
    userId: session.userId,
    currentPassword,
    newPassword,
    keepSessionTokenHash: session.sessionToken,
  });

  if (!result.ok) {
    return Response.json(
      { error: result.code, message: result.message },
      { status: result.status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return Response.json(
    {
      ok: true,
      mode: result.mode,
      revokedSessions: result.revokedSessions,
      message: result.mode === 'created' ? 'Password created.' : 'Password updated.',
    },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
