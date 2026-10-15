import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prismaClient } from '../db/prisma';
import { isAccountEmailDeliveryConfigured, sendPasswordResetEmail } from './email';
import { buildPasswordResetUrl } from './links';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  validatePasswordPolicy,
  verifyPassword,
  verifyPasswordOrDummy,
} from './passwords';
import { isValidEmail, normalizeEmail } from './policy';
import { createDirectDatabaseSession, type DirectDatabaseSession } from './session';

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const databaseClock = Prisma.sql`floor(extract(epoch from clock_timestamp())*1000)::bigint`;

interface PasswordAccountRow {
  user_id: string;
  name: string;
  contact_email: string;
  contact_verified: number;
  status: string;
  password_hash: string | null;
  email_identity_id: string | null;
}

async function findAccountByEmail(normalizedEmail: string): Promise<PasswordAccountRow | null> {
  const rows = await prismaClient().$queryRaw<PasswordAccountRow[]>`
    SELECT
      u.id AS user_id,
      u.name,
      COALESCE(a.contact_email, u.email, '') AS contact_email,
      COALESCE(a.contact_verified, 0) AS contact_verified,
      COALESCE(a.status, 'active') AS status,
      pc.password_hash,
      ei.id AS email_identity_id
    FROM users u
    JOIN managed_accounts a ON a.user_id = u.id
    LEFT JOIN password_credentials pc ON pc.user_id = u.id
    LEFT JOIN managed_identities ei
      ON ei.user_id = u.id AND ei.provider = 'email'
    WHERE lower(a.contact_email) = ${normalizedEmail}
       OR lower(u.email) = ${normalizedEmail}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function ensureEmailIdentityForUser(
  tx: Prisma.TransactionClient,
  userId: string,
  normalizedEmail: string,
): Promise<string> {
  const existing = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM managed_identities
    WHERE user_id = ${userId} AND provider = 'email'
    LIMIT 1
  `;
  if (existing[0]) {
    await tx.$executeRaw`
      UPDATE managed_identities
      SET email = ${normalizedEmail}, verified = 1, available = 1
      WHERE id = ${existing[0].id}
    `;
    return existing[0].id;
  }
  const identityId = randomUUID();
  await tx.$executeRaw`
    INSERT INTO managed_identities (id, user_id, issuer, subject, provider, email, verified, available)
    VALUES (${identityId}, ${userId}, 'studio:password', ${userId}, 'email', ${normalizedEmail}, 1, 1)
  `;
  return identityId;
}

export async function authenticateWithPassword(input: {
  email: string;
  password: string;
}): Promise<
  | {
      ok: true;
      user: { id: string; email: string; name: string };
      session: DirectDatabaseSession;
    }
  | {
      ok: false;
      status: number;
      code: 'invalid_credentials';
      message: string;
    }
> {
  const rawEmail = typeof input.email === 'string' ? input.email : '';
  const rawPassword = typeof input.password === 'string' ? input.password : '';
  if (!isValidEmail(rawEmail) || rawPassword.length === 0 || rawPassword.length > PASSWORD_MAX_LENGTH) {
    await verifyPasswordOrDummy(rawPassword, null);
    return {
      ok: false,
      status: 401,
      code: 'invalid_credentials',
      message: 'Invalid email or password.',
    };
  }

  const normalizedEmail = normalizeEmail(rawEmail);
  const account = await findAccountByEmail(normalizedEmail);
  const valid = await verifyPasswordOrDummy(rawPassword, account?.password_hash ?? null);

  if (
    !valid ||
    !account ||
    !account.password_hash ||
    account.contact_verified !== 1 ||
    !['active', 'pending-verification', 'deletion-pending'].includes(account.status)
  ) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_credentials',
      message: 'Invalid email or password.',
    };
  }

  const prisma = prismaClient();
  const identityId = await prisma.$transaction(async tx => {
    const ensuredId = await ensureEmailIdentityForUser(tx, account.user_id, normalizedEmail);
    await tx.$executeRaw`
      INSERT INTO identity_security_events (id, user_id, action, identity_id)
      VALUES (${randomUUID()}, ${account.user_id}, 'password-login', ${ensuredId})
    `;
    return ensuredId;
  });

  const session = await createDirectDatabaseSession({
    userId: account.user_id,
    identityId,
  });

  return {
    ok: true,
    user: {
      id: account.user_id,
      email: account.contact_email || normalizedEmail,
      name: account.name,
    },
    session,
  };
}

export async function requestPasswordReset(input: {
  email: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      status: 202;
      message: string;
      delivered: boolean;
    }
  | {
      ok: false;
      status: number;
      code: 'invalid_input' | 'delivery_unavailable';
      message: string;
    }
> {
  if (typeof input.email !== 'string' || !isValidEmail(input.email)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'A valid email address is required.',
    };
  }
  if (!isAccountEmailDeliveryConfigured()) {
    return {
      ok: false,
      status: 503,
      code: 'delivery_unavailable',
      message: 'Password reset email delivery is not configured.',
    };
  }

  const now = input.now ?? new Date();
  const normalizedEmail = normalizeEmail(input.email);
  const account = await findAccountByEmail(normalizedEmail);

  const genericMessage =
    'If an account with a password exists for that email address, a password reset link has been sent.';

  if (!account || !account.password_hash || account.contact_verified !== 1 || account.status !== 'active') {
    return {
      ok: true,
      status: 202,
      message: genericMessage,
      delivered: false,
    };
  }

  const token = generateOpaqueToken(32);
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  const prisma = prismaClient();

  await prisma.password_credentials.update({
    where: { user_id: account.user_id },
    data: {
      reset_token_hash: tokenHash,
      reset_expires_at: expiresAt,
      updated_at: now,
    },
  });

  const resetUrl = buildPasswordResetUrl(token);
  const delivery = await sendPasswordResetEmail({
    to: account.contact_email || normalizedEmail,
    resetUrl,
    expiresAt,
  });

  if (delivery.status !== 'sent') {
    await prisma.password_credentials.updateMany({
      where: { user_id: account.user_id, reset_token_hash: tokenHash },
      data: { reset_token_hash: null, reset_expires_at: null, updated_at: now },
    });
    return {
      ok: false,
      status: 503,
      code: 'delivery_unavailable',
      message: 'Password reset email could not be sent. Try again later.',
    };
  }

  return {
    ok: true,
    status: 202,
    message: genericMessage,
    delivered: true,
  };
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      userId: string;
      revokedSessions: number;
    }
  | {
      ok: false;
      status: number;
      code: 'invalid_input' | 'invalid_or_expired_token';
      message: string;
    }
> {
  const now = input.now ?? new Date();
  const rawToken = typeof input.token === 'string' ? input.token.trim() : '';
  if (rawToken.length < 16 || rawToken.length > 256) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_or_expired_token',
      message: 'This password reset link is invalid or has expired.',
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

  const tokenHash = hashOpaqueToken(rawToken);
  const passwordHash = await hashPassword(passwordCheck.value);
  const prisma = prismaClient();

  type TxResult =
    | { ok: true; userId: string; revokedSessions: number }
    | {
        ok: false;
        status: number;
        code: 'invalid_or_expired_token';
        message: string;
      };

  return prisma.$transaction(
    async tx => {
      const credential = await tx.password_credentials.findUnique({
        where: { reset_token_hash: tokenHash },
      });
      if (!credential || !credential.reset_expires_at) {
        return {
          ok: false,
          status: 400,
          code: 'invalid_or_expired_token',
          message: 'This password reset link is invalid or has already been used.',
        };
      }
      if (credential.reset_expires_at <= now) {
        await tx.password_credentials.update({
          where: { id: credential.id },
          data: {
            reset_token_hash: null,
            reset_expires_at: null,
            updated_at: now,
          },
        });
        return {
          ok: false,
          status: 410,
          code: 'invalid_or_expired_token',
          message: 'This password reset link has expired. Request a new reset link.',
        };
      }

      await tx.password_credentials.update({
        where: { id: credential.id },
        data: {
          password_hash: passwordHash,
          password_changed_at: now,
          reset_token_hash: null,
          reset_expires_at: null,
          updated_at: now,
        },
      });

      await tx.$executeRaw`
        UPDATE managed_accounts
        SET session_epoch = session_epoch + 1
        WHERE user_id = ${credential.user_id}
      `;
      const revoked = await tx.sessions.deleteMany({
        where: { user_id: credential.user_id },
      });
      await tx.$executeRaw`
        INSERT INTO identity_security_events (id, user_id, action)
        VALUES (${randomUUID()}, ${credential.user_id}, 'password-reset')
      `;

      return {
        ok: true,
        userId: credential.user_id,
        revokedSessions: revoked.count,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function setUserPassword(input: {
  userId: string;
  currentPassword?: string | null;
  newPassword: string;
  keepSessionTokenHash?: string | null;
  now?: Date;
}): Promise<
  | {
      ok: true;
      mode: 'created' | 'updated';
      revokedSessions: number;
    }
  | {
      ok: false;
      status: number;
      code: 'invalid_input' | 'invalid_current_password' | 'not_found';
      message: string;
    }
> {
  const now = input.now ?? new Date();
  const passwordCheck = validatePasswordPolicy(input.newPassword);
  if (!passwordCheck.ok) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: passwordCheck.message,
    };
  }

  const prisma = prismaClient();
  const userRows = await prisma.$queryRaw<
    Array<{ id: string; contact_email: string | null; email: string | null }>
  >`
    SELECT u.id, a.contact_email, u.email
    FROM users u
    JOIN managed_accounts a ON a.user_id = u.id
    WHERE u.id = ${input.userId}
    LIMIT 1
  `;
  const userRow = userRows[0];
  if (!userRow) {
    return {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'User not found.',
    };
  }

  const existing = await prisma.password_credentials.findUnique({
    where: { user_id: input.userId },
  });

  if (existing) {
    const currentValid = await verifyPassword(input.currentPassword ?? '', existing.password_hash);
    if (!currentValid) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_current_password',
        message: 'Current password is incorrect.',
      };
    }
  }

  const passwordHash = await hashPassword(passwordCheck.value);
  const normalizedEmail = normalizeEmail(userRow.contact_email ?? userRow.email ?? '');

  return prisma.$transaction(async tx => {
    if (existing) {
      await tx.password_credentials.update({
        where: { user_id: input.userId },
        data: {
          password_hash: passwordHash,
          password_changed_at: now,
          reset_token_hash: null,
          reset_expires_at: null,
          updated_at: now,
        },
      });
    } else {
      await tx.password_credentials.create({
        data: {
          id: randomUUID(),
          user_id: input.userId,
          password_hash: passwordHash,
          password_changed_at: now,
          created_at: now,
          updated_at: now,
        },
      });
    }

    if (normalizedEmail) {
      await ensureEmailIdentityForUser(tx, input.userId, normalizedEmail);
    }

    let revokedSessions = 0;
    if (input.keepSessionTokenHash) {
      await tx.$executeRaw`
        UPDATE managed_accounts
        SET session_epoch = session_epoch + 1
        WHERE user_id = ${input.userId}
      `;
      const deleted = await tx.sessions.deleteMany({
        where: {
          user_id: input.userId,
          token: { not: input.keepSessionTokenHash },
        },
      });
      await tx.$executeRaw`
        UPDATE managed_sessions
        SET epoch = epoch + 1, authenticated_at = ${databaseClock}, last_used = ${databaseClock}
        WHERE token = ${input.keepSessionTokenHash}
      `;
      revokedSessions = deleted.count;
    } else {
      await tx.$executeRaw`
        UPDATE managed_accounts
        SET session_epoch = session_epoch + 1
        WHERE user_id = ${input.userId}
      `;
      const deleted = await tx.sessions.deleteMany({
        where: { user_id: input.userId },
      });
      revokedSessions = deleted.count;
    }

    await tx.$executeRaw`
      INSERT INTO identity_security_events (id, user_id, action)
      VALUES (${randomUUID()}, ${input.userId}, ${existing ? 'password-changed' : 'password-added'})
    `;

    return {
      ok: true,
      mode: existing ? 'updated' : 'created',
      revokedSessions,
    };
  });
}

export async function getUserAuthMethods(userId: string): Promise<{
  hasPassword: boolean;
  providers: string[];
}> {
  const prisma = prismaClient();
  const [credential, identities] = await Promise.all([
    prisma.password_credentials.findUnique({
      where: { user_id: userId },
      select: { id: true },
    }),
    prisma.managed_identities.findMany({
      where: { user_id: userId, available: 1 },
      select: { provider: true },
      orderBy: { created_at: 'asc' },
    }),
  ]);
  const providers = Array.from(
    new Set(
      identities
        .map(item => item.provider)
        .filter(provider => provider !== 'email'),
    ),
  );
  return {
    hasPassword: Boolean(credential),
    providers,
  };
}
