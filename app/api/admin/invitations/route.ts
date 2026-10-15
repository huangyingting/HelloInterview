import { requireInvitationAdmin } from '../../../../server/account-admission/guard';
import {
  createAccountInvitation,
  listAccountInvitations,
} from '../../../../server/account-admission/invitations';
import { getAccountAdmissionMode } from '../../../../server/account-admission/policy';
import { isAccountEmailDeliveryConfigured } from '../../../../server/account-admission/email';
import { HttpError } from '../../../../server/http-error';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireInvitationAdmin(request, false);
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

  const invitations = await listAccountInvitations({ limit: 100 });
  return Response.json(
    {
      admissionMode: getAccountAdmissionMode(),
      emailDeliveryConfigured: isAccountEmailDeliveryConfigured(),
      invitations,
    },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: Request) {
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

  let body: {
    email?: unknown;
    expiresInDays?: unknown;
    expiresAt?: unknown;
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
  const expiresAt =
    typeof body.expiresAt === 'string'
      ? body.expiresAt
      : typeof body.expiresInDays === 'number' && Number.isFinite(body.expiresInDays)
        ? new Date(Date.now() + body.expiresInDays * 86_400_000)
        : undefined;

  const result = await createAccountInvitation({
    email,
    invitedById: session.userId,
    expiresAt,
  });

  if (!result.ok) {
    const status =
      result.code === 'account_exists' || result.code === 'active_invitation_exists' ? 409 : 400;
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
    { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
