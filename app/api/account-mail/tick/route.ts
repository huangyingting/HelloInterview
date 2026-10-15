import { timingSafeEqual } from 'node:crypto';
import {
  acknowledgeAccountEmail,
  claimNextAccountEmail,
  hasReadyAccountEmails,
} from '../../../../server/account-admission/email';
import { expireAllDueInvitations } from '../../../../server/account-admission/invitations';
import { pruneAccountAdmissionRecords } from '../../../../server/account-admission/retention';

export const dynamic = 'force-dynamic';

function validateWorkerToken(request: Request): Response | null {
  const configuredToken = (
    process.env.ACCOUNT_MAIL_WORKER_SECRET ||
    process.env.ACCOUNT_EMAIL_WORKER_TOKEN ||
    process.env.WORKER_TICK_TOKEN ||
    ''
  ).trim();
  if (!configuredToken) {
    return Response.json(
      { error: 'not_configured', message: 'Account email worker token is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerToken = request.headers.get('x-worker-token')?.trim() || bearer;
  if (!headerToken) {
    return Response.json(
      { error: 'unauthorized', message: 'Worker authentication required.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const left = Buffer.from(headerToken, 'utf8');
  const right = Buffer.from(configuredToken, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return Response.json(
      { error: 'unauthorized', message: 'Invalid worker authentication token.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return null;
}

export async function POST(request: Request) {
  const authError = validateWorkerToken(request);
  if (authError) return authError;

  let body: {
    action?: unknown;
    id?: unknown;
    outboxId?: unknown;
    claimToken?: unknown;
    outcome?: unknown;
    status?: unknown;
    errorMessage?: unknown;
    error?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const action = typeof body.action === 'string' ? body.action : 'status';

  if (action === 'claim') {
    const claimed = await claimNextAccountEmail();
    return Response.json(
      { claimed },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  if (action === 'ack') {
    const id =
      typeof body.id === 'string' && body.id.trim()
        ? body.id.trim()
        : typeof body.outboxId === 'string'
          ? body.outboxId.trim()
          : '';
    const claimToken = typeof body.claimToken === 'string' ? body.claimToken.trim() : '';
    const rawStatus = body.status ?? body.outcome;
    const status =
      rawStatus === 'sent'
        ? 'sent'
        : rawStatus === 'failed'
          ? 'failed'
          : rawStatus === 'unconfirmed'
            ? 'unconfirmed'
            : null;
    if (!id || !claimToken || !status) {
      return Response.json(
        {
          error: 'invalid_ack',
          message: 'id (or outboxId), claimToken, and status ("sent" | "failed" | "unconfirmed") are required.',
        },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const updated = await acknowledgeAccountEmail({
      id,
      claimToken,
      status,
      error:
        typeof body.error === 'string'
          ? body.error
          : typeof body.errorMessage === 'string'
            ? body.errorMessage
            : null,
    });
    return Response.json(
      { ok: updated },
      { status: updated ? 200 : 409, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  if (action === 'maintenance') {
    const expiredInvitations = await expireAllDueInvitations();
    const pruned = await pruneAccountAdmissionRecords();
    const ready = await hasReadyAccountEmails();
    return Response.json(
      {
        ok: true,
        expiredInvitations,
        pruned,
        readyEmails: ready,
      },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const ready = await hasReadyAccountEmails();
  return Response.json(
    { ok: true, readyEmails: ready },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
