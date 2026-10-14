import { randomUUID } from 'node:crypto';
import type { Account, Profile } from 'next-auth';
import { z } from 'zod';
import { invitationHash, type AuthSettings } from './config';
import { prismaClient } from '../db/prisma';

const providerSchema = z.enum(['google', 'facebook']);
export type SocialProvider = z.infer<typeof providerSchema>;

interface ExistingIdentity {
  readonly id: string;
  readonly userId: string;
  readonly status: string;
}

export interface SocialProof {
  readonly provider: SocialProvider;
  readonly issuer: string;
  readonly subject: string;
  readonly name: string;
  readonly email: string | null;
  readonly verifiedEmail: boolean;
}

export function socialProof(account: Account, profile: Profile): SocialProof {
  const provider = providerSchema.parse(account.provider);
  const subject = z.string().min(1).max(512).parse(account.providerAccountId);
  const rawEmail = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : null;
  const email = rawEmail && z.string().email().max(254).safeParse(rawEmail).success ? rawEmail : null;
  const rawName = typeof profile.name === 'string' ? profile.name.trim() : '';
  const name = rawName.length >= 2 && rawName.length <= 100 ? rawName : 'Studio participant';
  return {
    provider,
    issuer: provider === 'google' ? 'https://accounts.google.com' : 'https://www.facebook.com',
    subject,
    name,
    email,
    verifiedEmail: provider === 'google' && (profile as Profile & { email_verified?: unknown }).email_verified === true,
  };
}

export function assertSocialAdmission(settings: AuthSettings, proof: SocialProof, existing: ExistingIdentity | null) {
  if (existing && !['active', 'pending-verification', 'deletion-pending'].includes(existing.status)) {
    throw new Error('This account is not available for product access.');
  }
  if (proof.provider === 'facebook') {
    if (!existing) throw new Error('Facebook must first be linked from an existing verified Studio account.');
    return;
  }
  if (!proof.verifiedEmail || !proof.email) throw new Error('Google must provide a verified contact email.');
  if (!existing && !settings.inviteEmailHashes.includes(invitationHash(settings.secret, proof.email))) {
    throw new Error('This private beta requires an invitation for the verified contact email.');
  }
}

export async function admitSocialIdentity(settings: AuthSettings, account: Account, profile: Profile, currentOwner: string | null = null) {
  const proof = socialProof(account, profile);
  const prisma = prismaClient();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`
      SELECT 1 AS locked
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`${proof.issuer}:${proof.subject}`},0))) AS subject_lock
    `;
    const identities = await tx.$queryRaw<Array<{ id: string; user_id: string; status: string }>>`
      SELECT i.id,i.user_id,a.status
      FROM managed_identities i
      JOIN managed_accounts a ON a.user_id=i.user_id
      WHERE i.issuer=${proof.issuer} AND i.subject=${proof.subject}
      FOR UPDATE OF i,a
    `;
    const row = identities[0];
    const existing = row ? { id: row.id, userId: row.user_id, status: row.status } : null;
    if (currentOwner && existing?.userId !== currentOwner) {
      throw new Error(existing
        ? 'That provider identity belongs to another Studio account.'
        : 'Sign out before registering a different Studio account.');
    }
    assertSocialAdmission(settings, proof, existing);
    if (existing) {
      if (proof.provider === 'google') {
        await tx.$executeRaw`UPDATE managed_identities SET email=${proof.email},verified=1,available=1 WHERE id=${existing.id}`;
        await tx.$executeRaw`
          UPDATE managed_accounts
          SET contact_email=${proof.email},contact_verified=1,contact_identity_id=${existing.id}
          WHERE user_id=${existing.userId} AND (contact_verified=0 OR contact_identity_id=${existing.id})
        `;
      } else {
        await tx.$executeRaw`UPDATE managed_identities SET available=1 WHERE id=${existing.id}`;
      }
      await tx.$executeRaw`
        INSERT INTO identity_security_events (id,user_id,action,identity_id)
        VALUES (${randomUUID()},${existing.userId},'social-login',${existing.id})
      `;
      return { userId: existing.userId, identityId: existing.id };
    }
    const userId = randomUUID(), identityId = randomUUID();
    await tx.$executeRaw`INSERT INTO users (id,name,email,password,demo) VALUES (${userId},${proof.name},NULL,NULL,0)`;
    await tx.$executeRaw`INSERT INTO user_settings (user_id) VALUES (${userId})`;
    await tx.$executeRaw`
      INSERT INTO managed_identities (id,user_id,issuer,subject,provider,email,verified)
      VALUES (${identityId},${userId},${proof.issuer},${proof.subject},${proof.provider},${proof.email},1)
    `;
    await tx.$executeRaw`
      INSERT INTO managed_accounts (user_id,status,contact_email,contact_identity_id,contact_verified)
      VALUES (${userId},'active',${proof.email},${identityId},1)
    `;
    await tx.$executeRaw`
      INSERT INTO identity_security_events (id,user_id,action,identity_id)
      VALUES (${randomUUID()},${userId},'social-registration',${identityId})
    `;
    return { userId, identityId };
  }, { isolationLevel: 'Serializable' });
}
