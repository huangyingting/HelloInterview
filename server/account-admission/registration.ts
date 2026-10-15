import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prismaClient } from '../db/prisma';
import { isAccountEmailDeliveryConfigured, sendVerificationEmail } from './email';
import { buildEmailVerificationUrl } from './links';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  validatePasswordPolicy,
} from './passwords';
import { getAccountAdmissionMode, isValidEmail, normalizeEmail } from './policy';
import { createDirectDatabaseSession, type DirectDatabaseSession } from './session';

export const PENDING_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

function sanitizeName(value: unknown, fallbackEmail: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim().slice(0, 80);
    if (trimmed.length >= 2) return trimmed;
  }
  const localPart = fallbackEmail.split('@')[0]?.trim().slice(0, 60) ?? '';
  return localPart.length >= 2 ? localPart : 'Studio participant';
}

function sanitizeOptionalName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 80);
  return trimmed.length > 0 ? trimmed : null;
}

export async function registerInInvitationMode(input: {
  token: string;
  email: string;
  password: string;
  name?: string | null;
  now?: Date;
}): Promise<
  | {
      ok: true;
      user: { id: string; email: string; name: string };
      session: DirectDatabaseSession;
    }
  | {
      ok: false;
      status: number;
      code:
        | 'invalid_input'
        | 'invalid_invitation'
        | 'invitation_expired'
        | 'invitation_revoked'
        | 'invitation_accepted'
        | 'email_mismatch'
        | 'account_exists';
      message: string;
    }
> {
  const now = input.now ?? new Date();
  const rawToken = typeof input.token === 'string' ? input.token.trim() : '';
  if (rawToken.length < 16 || rawToken.length > 256) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_invitation',
      message: 'A valid invitation token is required.',
    };
  }
  if (typeof input.email !== 'string' || !isValidEmail(input.email)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'A valid email address is required.',
    };
  }
  const passwordCheck = validatePasswordPolicy(input.password);
  if (!passwordCheck.ok) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: passwordCheck.message,
    };
  }

  const normalizedEmail = normalizeEmail(input.email);
  const name = sanitizeName(input.name, normalizedEmail);
  const tokenHash = hashOpaqueToken(rawToken);
  const passwordHash = await hashPassword(passwordCheck.value);
  const prisma = prismaClient();

  type TxResult =
    | {
        ok: true;
        user: { id: string; identityId: string; email: string; name: string };
      }
    | {
        ok: false;
        status: number;
        code:
          | 'invalid_invitation'
          | 'invitation_expired'
          | 'invitation_revoked'
          | 'invitation_accepted'
          | 'email_mismatch'
          | 'account_exists';
        message: string;
      };

  let txResult: TxResult;
  try {
    txResult = await prisma.$transaction(
      async tx => {
        const invitation = await tx.account_invitations.findUnique({
          where: { token_hash: tokenHash },
        });
        if (!invitation) {
          return {
            ok: false,
            status: 404,
            code: 'invalid_invitation',
            message: 'This invitation link is invalid or has already been used.',
          };
        }

        if (invitation.status === 'PENDING' && invitation.expires_at <= now) {
          await tx.account_invitations.update({
            where: { id: invitation.id },
            data: {
              status: 'EXPIRED',
              active_for_email: null,
              token_hash: null,
              updated_at: now,
            },
          });
          return {
            ok: false,
            status: 410,
            code: 'invitation_expired',
            message: 'This invitation has expired. Ask an administrator for a new invitation.',
          };
        }

        if (invitation.status === 'REVOKED') {
          return {
            ok: false,
            status: 409,
            code: 'invitation_revoked',
            message: 'This invitation has been revoked.',
          };
        }
        if (invitation.status === 'ACCEPTED') {
          return {
            ok: false,
            status: 409,
            code: 'invitation_accepted',
            message: 'This invitation has already been accepted. Sign in instead.',
          };
        }
        if (invitation.status === 'EXPIRED') {
          return {
            ok: false,
            status: 410,
            code: 'invitation_expired',
            message: 'This invitation has expired.',
          };
        }

        if (invitation.normalized_email !== normalizedEmail) {
          return {
            ok: false,
            status: 403,
            code: 'email_mismatch',
            message: 'Enter the exact email address that received this invitation.',
          };
        }

        const existingUser = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT u.id
          FROM users u
          LEFT JOIN managed_accounts a ON a.user_id = u.id
          WHERE lower(u.email) = ${normalizedEmail} OR lower(a.contact_email) = ${normalizedEmail}
          LIMIT 1
        `;
        if (existingUser.length > 0) {
          return {
            ok: false,
            status: 409,
            code: 'account_exists',
            message: 'An account already exists for this email address.',
          };
        }

        const userId = randomUUID();
        const identityId = randomUUID();

        await tx.$executeRaw`
          INSERT INTO users (id, name, email, password, demo)
          VALUES (${userId}, ${name}, NULL, NULL, 0)
        `;
        await tx.$executeRaw`
          INSERT INTO user_settings (user_id) VALUES (${userId})
        `;
        await tx.$executeRaw`
          INSERT INTO managed_identities (id, user_id, issuer, subject, provider, email, verified, available)
          VALUES (${identityId}, ${userId}, 'studio:password', ${userId}, 'email', ${normalizedEmail}, 1, 1)
        `;
        await tx.$executeRaw`
          INSERT INTO managed_accounts (user_id, status, contact_email, contact_identity_id, contact_verified)
          VALUES (${userId}, 'active', ${normalizedEmail}, ${identityId}, 1)
        `;
        await tx.password_credentials.create({
          data: {
            id: randomUUID(),
            user_id: userId,
            password_hash: passwordHash,
            password_changed_at: now,
            created_at: now,
            updated_at: now,
          },
        });
        await tx.account_invitations.update({
          where: { id: invitation.id },
          data: {
            status: 'ACCEPTED',
            accepted_by_id: userId,
            accepted_at: now,
            active_for_email: null,
            token_hash: null,
            updated_at: now,
          },
        });
        await tx.$executeRaw`
          INSERT INTO identity_security_events (id, user_id, action, identity_id)
          VALUES (${randomUUID()}, ${userId}, 'invitation-accepted', ${identityId})
        `;

        return {
          ok: true,
          user: {
            id: userId,
            identityId,
            email: normalizedEmail,
            name,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        ok: false,
        status: 409,
        code: 'account_exists',
        message: 'An account already exists for this email address.',
      };
    }
    throw error;
  }

  if (!txResult.ok) {
    return txResult;
  }

  const session = await createDirectDatabaseSession({
    userId: txResult.user.id,
    identityId: txResult.user.identityId,
  });

  return {
    ok: true,
    user: {
      id: txResult.user.id,
      email: txResult.user.email,
      name: txResult.user.name,
    },
    session,
  };
}

export async function registerInPublicMode(input: {
  email: string;
  password: string;
  name?: string | null;
  now?: Date;
}): Promise<
  | {
      ok: true;
      status: 202;
      message: string;
      verificationDispatched: boolean;
    }
  | {
      ok: false;
      status: number;
      code: 'invitation_only' | 'invalid_input' | 'delivery_unavailable';
      message: string;
    }
> {
  if (getAccountAdmissionMode() !== 'public') {
    return {
      ok: false,
      status: 403,
      code: 'invitation_only',
      message: 'Public registration is disabled. An administrator invitation is required.',
    };
  }
  if (typeof input.email !== 'string' || !isValidEmail(input.email)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'A valid email address is required.',
    };
  }
  const passwordCheck = validatePasswordPolicy(input.password);
  if (!passwordCheck.ok) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: passwordCheck.message,
    };
  }
  if (!isAccountEmailDeliveryConfigured()) {
    return {
      ok: false,
      status: 503,
      code: 'delivery_unavailable',
      message: 'Email verification delivery is not configured.',
    };
  }

  const now = input.now ?? new Date();
  const normalizedEmail = normalizeEmail(input.email);
  const trimmedEmail = input.email.trim();
  const name = sanitizeOptionalName(input.name);
  const passwordHash = await hashPassword(passwordCheck.value);
  const prisma = prismaClient();

  const existingUser = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT u.id
    FROM users u
    LEFT JOIN managed_accounts a ON a.user_id = u.id
    WHERE lower(u.email) = ${normalizedEmail} OR lower(a.contact_email) = ${normalizedEmail}
    LIMIT 1
  `;
  if (existingUser.length > 0) {
    return {
      ok: true,
      status: 202,
      message:
        'If this email is eligible for registration, a verification link has been sent.',
      verificationDispatched: false,
    };
  }

  const token = generateOpaqueToken(32);
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(now.getTime() + PENDING_REGISTRATION_TTL_MS);

  await prisma.pending_registrations.upsert({
    where: { normalized_email: normalizedEmail },
    create: {
      id: randomUUID(),
      email: trimmedEmail,
      normalized_email: normalizedEmail,
      name,
      password_hash: passwordHash,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_at: now,
      updated_at: now,
    },
    update: {
      email: trimmedEmail,
      name,
      password_hash: passwordHash,
      token_hash: tokenHash,
      expires_at: expiresAt,
      updated_at: now,
    },
  });

  const verifyUrl = buildEmailVerificationUrl(token);
  const delivery = await sendVerificationEmail({
    to: trimmedEmail,
    verifyUrl,
    expiresAt,
  });

  if (delivery.status !== 'sent') {
    await prisma.pending_registrations.deleteMany({
      where: { normalized_email: normalizedEmail, token_hash: tokenHash },
    });
    return {
      ok: false,
      status: 503,
      code: 'delivery_unavailable',
      message: 'Verification email could not be sent. Try again later.',
    };
  }

  return {
    ok: true,
    status: 202,
    message: 'If this email is eligible for registration, a verification link has been sent.',
    verificationDispatched: true,
  };
}

export async function verifyPendingRegistrationToken(input: {
  token: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      user: { id: string; email: string; name: string };
      session: DirectDatabaseSession;
    }
  | {
      ok: false;
      status: number;
      code: 'invitation_only' | 'invalid_token' | 'expired_token' | 'account_exists';
      message: string;
    }
> {
  if (getAccountAdmissionMode() !== 'public') {
    return {
      ok: false,
      status: 403,
      code: 'invitation_only',
      message: 'Public email verification is disabled while the app is invitation-only.',
    };
  }

  const now = input.now ?? new Date();
  const rawToken = typeof input.token === 'string' ? input.token.trim() : '';
  if (rawToken.length < 16 || rawToken.length > 256) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_token',
      message: 'Verification link is invalid.',
    };
  }

  const tokenHash = hashOpaqueToken(rawToken);
  const prisma = prismaClient();

  type TxResult =
    | { ok: true; user: { id: string; identityId: string; email: string; name: string } }
    | {
        ok: false;
        status: number;
        code: 'invalid_token' | 'expired_token' | 'account_exists';
        message: string;
      };

  const txResult: TxResult = await prisma.$transaction(
    async tx => {
      const pending = await tx.pending_registrations.findUnique({
        where: { token_hash: tokenHash },
      });
      if (!pending) {
        return {
          ok: false,
          status: 404,
          code: 'invalid_token',
          message: 'Verification link is invalid or has already been used.',
        };
      }

      if (pending.expires_at <= now) {
        await tx.pending_registrations.delete({ where: { id: pending.id } });
        return {
          ok: false,
          status: 410,
          code: 'expired_token',
          message: 'Verification link has expired. Register again to request a new link.',
        };
      }

      const existingUser = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT u.id
        FROM users u
        LEFT JOIN managed_accounts a ON a.user_id = u.id
        WHERE lower(u.email) = ${pending.normalized_email} OR lower(a.contact_email) = ${pending.normalized_email}
        LIMIT 1
      `;
      if (existingUser.length > 0) {
        await tx.pending_registrations.delete({ where: { id: pending.id } });
        return {
          ok: false,
          status: 409,
          code: 'account_exists',
          message: 'An account already exists for this email address.',
        };
      }

      const userId = randomUUID();
      const identityId = randomUUID();
      const displayName = sanitizeName(pending.name, pending.normalized_email);

      await tx.$executeRaw`
        INSERT INTO users (id, name, email, password, demo)
        VALUES (${userId}, ${displayName}, NULL, NULL, 0)
      `;
      await tx.$executeRaw`
        INSERT INTO user_settings (user_id) VALUES (${userId})
      `;
      await tx.$executeRaw`
        INSERT INTO managed_identities (id, user_id, issuer, subject, provider, email, verified, available)
        VALUES (${identityId}, ${userId}, 'studio:password', ${userId}, 'email', ${pending.normalized_email}, 1, 1)
      `;
      await tx.$executeRaw`
        INSERT INTO managed_accounts (user_id, status, contact_email, contact_identity_id, contact_verified)
        VALUES (${userId}, 'active', ${pending.normalized_email}, ${identityId}, 1)
      `;
      await tx.password_credentials.create({
        data: {
          id: randomUUID(),
          user_id: userId,
          password_hash: pending.password_hash,
          password_changed_at: now,
          created_at: now,
          updated_at: now,
        },
      });
      await tx.pending_registrations.delete({ where: { id: pending.id } });
      await tx.$executeRaw`
        INSERT INTO identity_security_events (id, user_id, action, identity_id)
        VALUES (${randomUUID()}, ${userId}, 'email-registration', ${identityId})
      `;

      return {
        ok: true,
        user: {
          id: userId,
          identityId,
          email: pending.normalized_email,
          name: displayName,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  if (!txResult.ok) return txResult;

  const session = await createDirectDatabaseSession({
    userId: txResult.user.id,
    identityId: txResult.user.identityId,
  });

  return {
    ok: true,
    user: {
      id: txResult.user.id,
      email: txResult.user.email,
      name: txResult.user.name,
    },
    session,
  };
}
