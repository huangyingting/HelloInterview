import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { prismaClient } from '../db/prisma';

export interface AccountEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  kind: 'invitation' | 'email-verification' | 'password-reset';
  expiresAt?: Date;
  invitationId?: string;
}

export interface EmailDeliveryResult {
  status: 'sent' | 'unavailable' | 'failed';
  message: string;
}

export interface ClaimedAccountEmail {
  id: string;
  claimToken: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  kind: AccountEmailMessage['kind'];
}

type SentEmailRecord = AccountEmailMessage & { sentAt: string };

declare global {
  var __studioAccountAdmissionEmails: SentEmailRecord[] | undefined;
}

const DEFAULT_OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;
const SENDING_LEASE_TTL_MS = 15 * 60 * 1000;
const ENCRYPTION_VERSION = 'v1';

function getTestSink(): SentEmailRecord[] {
  if (!globalThis.__studioAccountAdmissionEmails) {
    globalThis.__studioAccountAdmissionEmails = [];
  }
  return globalThis.__studioAccountAdmissionEmails;
}

export function getCapturedAccountEmailsForTest(): SentEmailRecord[] {
  return [...getTestSink()];
}

export function clearCapturedAccountEmailsForTest(): void {
  globalThis.__studioAccountAdmissionEmails = [];
}

function getOutboxEncryptionKey(): Buffer | null {
  const secret = process.env.NEXTAUTH_SECRET?.trim() ?? '';
  if (secret.length < 32) return null;
  return scryptSync(secret, 'studio-account-email-outbox-v1', 32);
}

function encryptOutboxPayload(message: AccountEmailMessage): string {
  const key = getOutboxEncryptionKey();
  if (!key) {
    throw new Error('NEXTAUTH_SECRET must be at least 32 characters to queue account email.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify({
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    kind: message.kind,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptOutboxPayload(payload: string): Omit<ClaimedAccountEmail, 'id' | 'claimToken'> {
  const key = getOutboxEncryptionKey();
  if (!key) {
    throw new Error('NEXTAUTH_SECRET must be at least 32 characters to read account email.');
  }
  const [version, ivPart, tagPart, ciphertextPart] = payload.split('.');
  if (version !== ENCRYPTION_VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Unsupported account email payload format.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  const parsed = JSON.parse(plaintext) as Partial<Omit<ClaimedAccountEmail, 'id' | 'claimToken'>>;
  if (
    typeof parsed.to !== 'string' ||
    typeof parsed.subject !== 'string' ||
    typeof parsed.text !== 'string' ||
    typeof parsed.html !== 'string' ||
    (parsed.kind !== 'invitation' &&
      parsed.kind !== 'email-verification' &&
      parsed.kind !== 'password-reset')
  ) {
    throw new Error('Invalid decrypted account email payload.');
  }
  return {
    to: parsed.to,
    subject: parsed.subject,
    text: parsed.text,
    html: parsed.html,
    kind: parsed.kind,
  };
}

export function isAccountEmailDeliveryConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const workflowEnabled = env.ACCOUNT_MAIL_WORKFLOW_ENABLED?.trim().toLowerCase() === 'true';
  const workerSecret = env.ACCOUNT_MAIL_WORKER_SECRET?.trim() ?? '';
  const authSecret = env.NEXTAUTH_SECRET?.trim() ?? '';
  return workflowEnabled && workerSecret.length >= 32 && authSecret.length >= 32;
}

export async function sendAccountEmail(message: AccountEmailMessage): Promise<EmailDeliveryResult> {
  if (!isAccountEmailDeliveryConfigured()) {
    return {
      status: 'unavailable',
      message: 'Automatic email delivery is not configured.',
    };
  }

  try {
    const expiresAt = message.expiresAt ?? new Date(Date.now() + DEFAULT_OUTBOX_TTL_MS);
    await prismaClient().account_email_outbox.create({
      data: {
        id: randomUUID(),
        payload: encryptOutboxPayload(message),
        status: 'pending',
        expires_at: expiresAt,
        invitation_id: message.invitationId ?? null,
      },
    });
    if (process.env.NODE_ENV === 'test') {
      getTestSink().push({ ...message, sentAt: new Date().toISOString() });
    }
    return {
      status: 'sent',
      message: 'Email queued for delivery.',
    };
  } catch {
    return {
      status: 'failed',
      message: 'Email delivery could not be queued.',
    };
  }
}

async function expireStaleAccountEmails(now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - SENDING_LEASE_TTL_MS);
  const prisma = prismaClient();
  await prisma.account_email_outbox.updateMany({
    where: {
      status: 'pending',
      expires_at: { lte: now },
    },
    data: {
      status: 'expired',
      claim_token: null,
      last_error: 'Expired before delivery.',
    },
  });
  await prisma.account_email_outbox.updateMany({
    where: {
      status: 'sending',
      last_attempt_at: { lte: staleBefore },
    },
    data: {
      status: 'unconfirmed',
      claim_token: null,
      last_error: 'Sender worker lease expired before delivery was acknowledged.',
    },
  });
}

export async function hasReadyAccountEmails(now = new Date()): Promise<boolean> {
  await expireStaleAccountEmails(now);
  const count = await prismaClient().account_email_outbox.count({
    where: {
      status: 'pending',
      expires_at: { gt: now },
    },
  });
  return count > 0;
}

export async function claimNextAccountEmail(now = new Date()): Promise<ClaimedAccountEmail | null> {
  await expireStaleAccountEmails(now);
  const prisma = prismaClient();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await prisma.account_email_outbox.findFirst({
      where: {
        status: 'pending',
        expires_at: { gt: now },
      },
      orderBy: { created_at: 'asc' },
    });
    if (!candidate) return null;

    const claimToken = randomBytes(24).toString('base64url');
    const claimed = await prisma.account_email_outbox.updateMany({
      where: {
        id: candidate.id,
        status: 'pending',
        expires_at: { gt: now },
      },
      data: {
        status: 'sending',
        claim_token: claimToken,
        last_attempt_at: now,
      },
    });
    if (claimed.count !== 1) continue;

    try {
      const decrypted = decryptOutboxPayload(candidate.payload);
      return {
        id: candidate.id,
        claimToken,
        ...decrypted,
      };
    } catch {
      await prisma.account_email_outbox.update({
        where: { id: candidate.id },
        data: {
          status: 'failed',
          claim_token: null,
          last_error: 'Encrypted payload could not be read.',
        },
      });
      return null;
    }
  }

  return null;
}

export async function acknowledgeAccountEmail(input: {
  id: string;
  claimToken: string;
  status: 'sent' | 'failed' | 'unconfirmed';
  error?: string | null;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const errorMessage = input.error?.trim().slice(0, 240) || null;
  const updated = await prismaClient().account_email_outbox.updateMany({
    where: {
      id: input.id,
      status: 'sending',
      claim_token: input.claimToken,
    },
    data: {
      status: input.status,
      claim_token: null,
      sent_at: input.status === 'sent' ? now : null,
      last_error: input.status === 'sent' ? null : errorMessage ?? 'Delivery failed.',
    },
  });
  return updated.count === 1;
}

export async function sendInvitationEmail(params: {
  invitationId?: string;
  to: string;
  acceptUrl: string;
  expiresAt: Date;
}): Promise<EmailDeliveryResult> {
  const expiresLabel = params.expiresAt.toUTCString();
  return sendAccountEmail({
    to: params.to,
    subject: 'Your Interview Studio invitation',
    text: `You have been invited to create an Interview Studio account.\n\nAccept your invitation: ${params.acceptUrl}\n\nThis single-use link expires on ${expiresLabel}.`,
    html: `<p>You have been invited to create an Interview Studio account.</p><p><a href="${params.acceptUrl}">Accept your invitation</a></p><p>This single-use link expires on ${expiresLabel}.</p>`,
    kind: 'invitation',
    expiresAt: params.expiresAt,
    invitationId: params.invitationId,
  });
}

export async function sendVerificationEmail(params: {
  to: string;
  verifyUrl: string;
  expiresAt: Date;
}): Promise<EmailDeliveryResult> {
  const expiresLabel = params.expiresAt.toUTCString();
  return sendAccountEmail({
    to: params.to,
    subject: 'Verify your Interview Studio email address',
    text: `Confirm your email address to finish creating your Interview Studio account.\n\nVerify email: ${params.verifyUrl}\n\nThis single-use link expires on ${expiresLabel}.`,
    html: `<p>Confirm your email address to finish creating your Interview Studio account.</p><p><a href="${params.verifyUrl}">Verify your email address</a></p><p>This single-use link expires on ${expiresLabel}.</p>`,
    kind: 'email-verification',
    expiresAt: params.expiresAt,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
  expiresAt: Date;
}): Promise<EmailDeliveryResult> {
  const expiresLabel = params.expiresAt.toUTCString();
  return sendAccountEmail({
    to: params.to,
    subject: 'Reset your Interview Studio password',
    text: `A password reset was requested for your Interview Studio account.\n\nReset password: ${params.resetUrl}\n\nThis single-use link expires on ${expiresLabel}. If you did not request this, you can ignore this email.`,
    html: `<p>A password reset was requested for your Interview Studio account.</p><p><a href="${params.resetUrl}">Reset your password</a></p><p>This single-use link expires on ${expiresLabel}. If you did not request this, you can ignore this email.</p>`,
    kind: 'password-reset',
    expiresAt: params.expiresAt,
  });
}
