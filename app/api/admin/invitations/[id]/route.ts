import { requireInvitationAdmin } from '../../../../../server/account-admission/guard';
import { revokeAccountInvitation } from '../../../../../server/account-admission/invitations';
import { HttpError } from '../../../../../server/http-error';

export const dynamic = 'force-dynamic';

export async function DELETE(
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

  const { id } = await context.params;
  const result = await revokeAccountInvitation({
    invitationId: id,
    actorId: session.userId,
  });

  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : 409;
    return Response.json(
      { error: result.code, message: result.message },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return Response.json(
    { invitation: result.invitation },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
