import { requireInvitationAdmin } from '../../../../../../server/account-admission/guard';
import { rotateAccountInvitation } from '../../../../../../server/account-admission/invitations';
import { HttpError } from '../../../../../../server/http-error';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireInvitationAdmin(request, true);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 403;
    return Response.json(
      {
        error: status === 401 ? 'unauthorized' : 'forbidden',
        message: error instanceof Error ? error.message : 'Administrator access required.',
      },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  let body: { expiresInDays?: unknown; expiresAt?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const { id } = await context.params;
  const expiresAt =
    typeof body.expiresAt === 'string'
      ? body.expiresAt
      : typeof body.expiresInDays === 'number' && Number.isFinite(body.expiresInDays)
        ? new Date(Date.now() + body.expiresInDays * 86_400_000)
        : undefined;

  const result = await rotateAccountInvitation({
    invitationId: id,
    actorId: session.userId,
    expiresAt,
  });

  if (!result.ok) {
    const status =
      result.code === 'not_found'
        ? 404
        : result.code === 'invalid_expiration'
          ? 400
          : 409;
    return Response.json(
      { error: result.code, message: result.message },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return Response.json(
    {
      invitation: result.invitation,
      acceptUrl: result.acceptUrl,
      delivery: result.delivery,
      emailDelivery: {
        queued: result.delivery.status === 'sent',
        status: result.delivery.status,
        message: result.delivery.message,
      },
    },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
