import { prismaClient } from '../db/prisma';
import { expireAllDueInvitations } from './invitations';
import { getAccountAdmissionRetentionDays } from './policy';

export interface AccountAdmissionRetentionResult {
  expiredInvitationsMarked: number;
  terminalInvitationsDeleted: number;
  expiredPendingRegistrationsDeleted: number;
  expiredPasswordResetTokensCleared: number;
  terminalOutboxEmailsDeleted: number;
  retentionDays: number;
}

export async function pruneAccountAdmissionRecords(
  now = new Date(),
): Promise<AccountAdmissionRetentionResult> {
  const retentionDays = getAccountAdmissionRetentionDays();
  const terminalInvitationCutoff = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
  );

  const expiredInvitationsMarked = await expireAllDueInvitations(now);
  const prisma = prismaClient();

  const [
    terminalInvitations,
    expiredPendingRegistrations,
    expiredPasswordResetTokens,
    terminalOutboxEmails,
  ] = await Promise.all([
    prisma.account_invitations.deleteMany({
      where: {
        status: { in: ['ACCEPTED', 'REVOKED', 'EXPIRED'] },
        updated_at: { lt: terminalInvitationCutoff },
      },
    }),
    prisma.pending_registrations.deleteMany({
      where: {
        expires_at: { lte: now },
      },
    }),
    prisma.password_credentials.updateMany({
      where: {
        reset_expires_at: { lte: now },
      },
      data: {
        reset_token_hash: null,
        reset_expires_at: null,
        updated_at: now,
      },
    }),
    prisma.account_email_outbox.deleteMany({
      where: {
        OR: [
          { status: { not: 'sending' }, expires_at: { lte: now } },
          {
            status: { in: ['sent', 'failed', 'unconfirmed', 'expired'] },
            created_at: { lt: terminalInvitationCutoff },
          },
        ],
      },
    }),
  ]);

  return {
    expiredInvitationsMarked,
    terminalInvitationsDeleted: terminalInvitations.count,
    expiredPendingRegistrationsDeleted: expiredPendingRegistrations.count,
    expiredPasswordResetTokensCleared: expiredPasswordResetTokens.count,
    terminalOutboxEmailsDeleted: terminalOutboxEmails.count,
    retentionDays,
  };
}
