import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prismaClient } from '../db/prisma';
import { sendInvitationEmail, type EmailDeliveryResult } from './email';
import { buildInvitationAcceptUrl } from './links';
import { generateOpaqueToken, hashOpaqueToken } from './passwords';
import { isValidEmail, maskEmail, normalizeEmail } from './policy';

export const DEFAULT_INVITATION_TTL_DAYS = 7;
export const MAX_INVITATION_TTL_DAYS = 30;

export interface AccountInvitationSummary {
  id: string;
  email: string;
  normalizedEmail: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  invitedBy: { id: string; email: string | null; name: string | null } | null;
  acceptedBy: { id: string; email: string | null; name: string | null } | null;
  delivery: {
    status: 'pending' | 'sending' | 'sent' | 'failed' | 'unconfirmed' | 'expired';
    lastError: string | null;
    lastAttemptAt: string | null;
    sentAt: string | null;
    createdAt: string;
  } | null;
}

export interface InvitationInspectionResult {
  id?: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired' | 'invalid';
  maskedEmail: string | null;
  expiresAt: string | null;
}

type DbClient = Prisma.TransactionClient | ReturnType<typeof prismaClient>;

function toSummary(record: {
  id: string;
  email: string;
  normalized_email: string;
  status: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  invited_by?: {
    id: string;
    email: string | null;
    name: string | null;
    managed_accounts?: { contact_email: string | null } | null;
  } | null;
  accepted_by?: {
    id: string;
    email: string | null;
    name: string | null;
    managed_accounts?: { contact_email: string | null } | null;
  } | null;
  account_email_outbox?: Array<{
    status: string;
    last_error: string | null;
    last_attempt_at: Date | null;
    sent_at: Date | null;
    created_at: Date;
  }>;
}): AccountInvitationSummary {
  const latestDelivery = record.account_email_outbox?.[0] ?? null;
  return {
    id: record.id,
    email: record.email,
    normalizedEmail: record.normalized_email,
    status: record.status as AccountInvitationSummary['status'],
    expiresAt: record.expires_at.toISOString(),
    acceptedAt: record.accepted_at ? record.accepted_at.toISOString() : null,
    revokedAt: record.revoked_at ? record.revoked_at.toISOString() : null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
    invitedBy: record.invited_by
      ? {
          id: record.invited_by.id,
          email: record.invited_by.managed_accounts?.contact_email ?? record.invited_by.email,
          name: record.invited_by.name,
        }
      : null,
    acceptedBy: record.accepted_by
      ? {
          id: record.accepted_by.id,
          email: record.accepted_by.managed_accounts?.contact_email ?? record.accepted_by.email,
          name: record.accepted_by.name,
        }
      : null,
    delivery: latestDelivery
      ? {
          status: latestDelivery.status as NonNullable<AccountInvitationSummary['delivery']>['status'],
          lastError: latestDelivery.last_error,
          lastAttemptAt: latestDelivery.last_attempt_at
            ? latestDelivery.last_attempt_at.toISOString()
            : null,
          sentAt: latestDelivery.sent_at ? latestDelivery.sent_at.toISOString() : null,
          createdAt: latestDelivery.created_at.toISOString(),
        }
      : null,
  };
}

export function resolveInvitationExpiresAt(
  expiresAt?: string | Date | null,
  now = new Date(),
): { ok: true; value: Date } | { ok: false; message: string } {
  if (!expiresAt) {
    return {
      ok: true,
      value: new Date(now.getTime() + DEFAULT_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    };
  }
  const parsed = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: 'Invitation expiration timestamp is invalid.' };
  }
  const minTime = now.getTime() + 5 * 60 * 1000;
  const maxTime = now.getTime() + MAX_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (parsed.getTime() < minTime) {
    return { ok: false, message: 'Invitation expiration must be at least 5 minutes in the future.' };
  }
  if (parsed.getTime() > maxTime) {
    return {
      ok: false,
      message: `Invitation expiration cannot exceed ${MAX_INVITATION_TTL_DAYS} days.`,
    };
  }
  return { ok: true, value: parsed };
}

export async function expirePendingInvitationsForEmail(
  db: DbClient,
  normalizedEmail: string,
  now = new Date(),
): Promise<number> {
  const result = await db.account_invitations.updateMany({
    where: {
      normalized_email: normalizedEmail,
      status: 'PENDING',
      expires_at: { lte: now },
    },
    data: {
      status: 'EXPIRED',
      active_for_email: null,
      token_hash: null,
      updated_at: now,
    },
  });
  return result.count;
}

export async function expireAllDueInvitations(now = new Date()): Promise<number> {
  const result = await prismaClient().account_invitations.updateMany({
    where: {
      status: 'PENDING',
      expires_at: { lte: now },
    },
    data: {
      status: 'EXPIRED',
      active_for_email: null,
      token_hash: null,
      updated_at: now,
    },
  });
  return result.count;
}

async function hasExistingUserForEmail(db: DbClient, normalizedEmail: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT u.id
    FROM users u
    LEFT JOIN managed_accounts a ON a.user_id = u.id
    WHERE lower(u.email) = ${normalizedEmail} OR lower(a.contact_email) = ${normalizedEmail}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function createAccountInvitation(input: {
  email: string;
  invitedById: string;
  expiresAt?: string | Date | null;
  now?: Date;
}): Promise<
  | {
      ok: true;
      invitation: AccountInvitationSummary;
      token: string;
      acceptUrl: string;
      delivery: EmailDeliveryResult;
    }
  | {
      ok: false;
      code: 'invalid_email' | 'invalid_expiration' | 'account_exists' | 'active_invitation_exists';
      message: string;
    }
> {
  const now = input.now ?? new Date();
  if (typeof input.email !== 'string' || !isValidEmail(input.email)) {
    return { ok: false, code: 'invalid_email', message: 'A valid email address is required.' };
  }
  const normalizedEmail = normalizeEmail(input.email);
  const trimmedEmail = input.email.trim();
  const resolvedExpiry = resolveInvitationExpiresAt(input.expiresAt, now);
  if (!resolvedExpiry.ok) {
    return { ok: false, code: 'invalid_expiration', message: resolvedExpiry.message };
  }

  const token = generateOpaqueToken(32);
  const tokenHash = hashOpaqueToken(token);
  const prisma = prismaClient();

  type TxResult =
    | { ok: true; record: Parameters<typeof toSummary>[0] }
    | { ok: false; code: 'account_exists' | 'active_invitation_exists'; message: string };

  let txResult: TxResult;
  try {
    txResult = await prisma.$transaction(
      async tx => {
        await expirePendingInvitationsForEmail(tx, normalizedEmail, now);

        if (await hasExistingUserForEmail(tx, normalizedEmail)) {
          return {
            ok: false,
            code: 'account_exists',
            message: 'An account already exists for that email address.',
          };
        }

        const existingInvite = await tx.account_invitations.findFirst({
          where: {
            normalized_email: normalizedEmail,
            status: 'PENDING',
            expires_at: { gt: now },
          },
          select: { id: true },
        });
        if (existingInvite) {
          return {
            ok: false,
            code: 'active_invitation_exists',
            message:
              'An active invitation already exists for that email address. Rotate or revoke it instead.',
          };
        }

        const created = await tx.account_invitations.create({
          data: {
            id: randomUUID(),
            email: trimmedEmail,
            normalized_email: normalizedEmail,
            active_for_email: normalizedEmail,
            token_hash: tokenHash,
            status: 'PENDING',
            invited_by_id: input.invitedById,
            expires_at: resolvedExpiry.value,
            created_at: now,
            updated_at: now,
          },
          include: {
            invited_by: {
              select: {
                id: true,
                email: true,
                name: true,
                managed_accounts: { select: { contact_email: true } },
              },
            },
            accepted_by: {
              select: {
                id: true,
                email: true,
                name: true,
                managed_accounts: { select: { contact_email: true } },
              },
            },
          },
        });

        return { ok: true, record: created };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        ok: false,
        code: 'active_invitation_exists',
        message:
          'An active invitation already exists for that email address. Rotate or revoke it instead.',
      };
    }
    throw error;
  }

  if (!txResult.ok) {
    return txResult;
  }

  const acceptUrl = buildInvitationAcceptUrl(token);
  const delivery = await sendInvitationEmail({
    invitationId: txResult.record.id,
    to: trimmedEmail,
    acceptUrl,
    expiresAt: resolvedExpiry.value,
  });

  const refreshed = await prisma.account_invitations.findUnique({
    where: { id: txResult.record.id },
    include: {
      invited_by: {
        select: {
          id: true,
          email: true,
          name: true,
          managed_accounts: { select: { contact_email: true } },
        },
      },
      accepted_by: {
        select: {
          id: true,
          email: true,
          name: true,
          managed_accounts: { select: { contact_email: true } },
        },
      },
      account_email_outbox: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: {
          status: true,
          last_error: true,
          last_attempt_at: true,
          sent_at: true,
          created_at: true,
        },
      },
    },
  });

  return {
    ok: true,
    invitation: toSummary(refreshed ?? txResult.record),
    token,
    acceptUrl,
    delivery,
  };
}

export async function rotateAccountInvitation(input: {
  invitationId: string;
  actorId: string;
  expiresAt?: string | Date | null;
  now?: Date;
}): Promise<
  | {
      ok: true;
      invitation: AccountInvitationSummary;
      token: string;
      acceptUrl: string;
      delivery: EmailDeliveryResult;
    }
  | {
      ok: false;
      code: 'not_found' | 'not_pending' | 'invalid_expiration' | 'account_exists';
      message: string;
    }
> {
  const now = input.now ?? new Date();
  const resolvedExpiry = resolveInvitationExpiresAt(input.expiresAt, now);
  if (!resolvedExpiry.ok) {
    return { ok: false, code: 'invalid_expiration', message: resolvedExpiry.message };
  }

  const token = generateOpaqueToken(32);
  const tokenHash = hashOpaqueToken(token);
  const prisma = prismaClient();

  type TxResult =
    | { ok: true; record: Parameters<typeof toSummary>[0] }
    | { ok: false; code: 'not_found' | 'not_pending' | 'account_exists'; message: string };

  const txResult: TxResult = await prisma.$transaction(
    async tx => {
      const current = await tx.account_invitations.findUnique({
        where: { id: input.invitationId },
      });
      if (!current) {
        return { ok: false, code: 'not_found', message: 'Invitation not found.' };
      }

      if (current.status === 'PENDING' && current.expires_at <= now) {
        await tx.account_invitations.update({
          where: { id: current.id },
          data: {
            status: 'EXPIRED',
            active_for_email: null,
            token_hash: null,
            updated_at: now,
          },
        });
        return {
          ok: false,
          code: 'not_pending',
          message: 'This invitation has already expired. Create a new invitation instead.',
        };
      }

      if (current.status !== 'PENDING') {
        return {
          ok: false,
          code: 'not_pending',
          message: 'Only pending invitations can be rotated.',
        };
      }

      if (await hasExistingUserForEmail(tx, current.normalized_email)) {
        return {
          ok: false,
          code: 'account_exists',
          message: 'An account already exists for that email address.',
        };
      }

      const updated = await tx.account_invitations.update({
        where: { id: current.id },
        data: {
          token_hash: tokenHash,
          active_for_email: current.normalized_email,
          expires_at: resolvedExpiry.value,
          invited_by_id: input.actorId,
          updated_at: now,
        },
        include: {
          invited_by: {
            select: {
              id: true,
              email: true,
              name: true,
              managed_accounts: { select: { contact_email: true } },
            },
          },
          accepted_by: {
            select: {
              id: true,
              email: true,
              name: true,
              managed_accounts: { select: { contact_email: true } },
            },
          },
        },
      });

      return { ok: true, record: updated };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  if (!txResult.ok) {
    return txResult;
  }

  const acceptUrl = buildInvitationAcceptUrl(token);
  const delivery = await sendInvitationEmail({
    invitationId: txResult.record.id,
    to: txResult.record.email,
    acceptUrl,
    expiresAt: resolvedExpiry.value,
  });

  const refreshed = await prisma.account_invitations.findUnique({
    where: { id: txResult.record.id },
    include: {
      invited_by: {
        select: {
          id: true,
          email: true,
          name: true,
          managed_accounts: { select: { contact_email: true } },
        },
      },
      accepted_by: {
        select: {
          id: true,
          email: true,
          name: true,
          managed_accounts: { select: { contact_email: true } },
        },
      },
      account_email_outbox: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: {
          status: true,
          last_error: true,
          last_attempt_at: true,
          sent_at: true,
          created_at: true,
        },
      },
    },
  });

  return {
    ok: true,
    invitation: toSummary(refreshed ?? txResult.record),
    token,
    acceptUrl,
    delivery,
  };
}

export async function revokeAccountInvitation(input: {
  invitationId: string;
  actorId: string;
  now?: Date;
}): Promise<
  | { ok: true; invitation: AccountInvitationSummary }
  | { ok: false; code: 'not_found' | 'not_pending'; message: string }
> {
  const now = input.now ?? new Date();
  const prisma = prismaClient();

  type TxResult =
    | { ok: true; record: Parameters<typeof toSummary>[0] }
    | { ok: false; code: 'not_found' | 'not_pending'; message: string };

  const txResult: TxResult = await prisma.$transaction(
    async tx => {
      const current = await tx.account_invitations.findUnique({
        where: { id: input.invitationId },
      });
      if (!current) {
        return { ok: false, code: 'not_found', message: 'Invitation not found.' };
      }

      if (current.status === 'PENDING' && current.expires_at <= now) {
        await tx.account_invitations.update({
          where: { id: current.id },
          data: {
            status: 'EXPIRED',
            active_for_email: null,
            token_hash: null,
            updated_at: now,
          },
        });
        return {
          ok: false,
          code: 'not_pending',
          message: 'This invitation has already expired.',
        };
      }

      if (current.status !== 'PENDING') {
        return {
          ok: false,
          code: 'not_pending',
          message: 'Only pending invitations can be revoked.',
        };
      }

      const updated = await tx.account_invitations.update({
        where: { id: current.id },
        data: {
          status: 'REVOKED',
          revoked_at: now,
          active_for_email: null,
          token_hash: null,
          updated_at: now,
        },
        include: {
          invited_by: {
            select: {
              id: true,
              email: true,
              name: true,
              managed_accounts: { select: { contact_email: true } },
            },
          },
          accepted_by: {
            select: {
              id: true,
              email: true,
              name: true,
              managed_accounts: { select: { contact_email: true } },
            },
          },
          account_email_outbox: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: {
              status: true,
              last_error: true,
              last_attempt_at: true,
              sent_at: true,
              created_at: true,
            },
          },
        },
      });

      return { ok: true, record: updated };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  if (!txResult.ok) return txResult;
  return { ok: true, invitation: toSummary(txResult.record) };
}

export async function listAccountInvitations(params?: {
  status?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  limit?: number;
  now?: Date;
}): Promise<AccountInvitationSummary[]> {
  const now = params?.now ?? new Date();
  await expireAllDueInvitations(now);
  const limit = Math.min(Math.max(params?.limit ?? 100, 1), 250);
  const rows = await prismaClient().account_invitations.findMany({
    where: params?.status ? { status: params.status } : undefined,
    orderBy: [{ created_at: 'desc' }],
    take: limit,
    include: {
      invited_by: {
        select: {
          id: true,
          email: true,
          name: true,
          managed_accounts: { select: { contact_email: true } },
        },
      },
      accepted_by: {
        select: {
          id: true,
          email: true,
          name: true,
          managed_accounts: { select: { contact_email: true } },
        },
      },
      account_email_outbox: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: {
          status: true,
          last_error: true,
          last_attempt_at: true,
          sent_at: true,
          created_at: true,
        },
      },
    },
  });
  return rows.map(toSummary);
}

export async function inspectInvitationToken(
  rawToken: string,
  now = new Date(),
): Promise<InvitationInspectionResult> {
  const trimmed = rawToken?.trim() ?? '';
  if (trimmed.length < 16 || trimmed.length > 256) {
    return { status: 'invalid', maskedEmail: null, expiresAt: null };
  }
  const tokenHash = hashOpaqueToken(trimmed);
  const prisma = prismaClient();
  const invitation = await prisma.account_invitations.findUnique({
    where: { token_hash: tokenHash },
  });
  if (!invitation) {
    return { status: 'invalid', maskedEmail: null, expiresAt: null };
  }

  if (invitation.status === 'PENDING' && invitation.expires_at <= now) {
    await prisma.account_invitations.update({
      where: { id: invitation.id },
      data: {
        status: 'EXPIRED',
        active_for_email: null,
        token_hash: null,
        updated_at: now,
      },
    });
    return {
      id: invitation.id,
      status: 'expired',
      maskedEmail: maskEmail(invitation.email),
      expiresAt: invitation.expires_at.toISOString(),
    };
  }

  const statusMap: Record<AccountInvitationSummary['status'], InvitationInspectionResult['status']> = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REVOKED: 'revoked',
    EXPIRED: 'expired',
  };

  return {
    id: invitation.id,
    status: statusMap[invitation.status as AccountInvitationSummary['status']] ?? 'invalid',
    maskedEmail: maskEmail(invitation.email),
    expiresAt: invitation.expires_at.toISOString(),
  };
}
