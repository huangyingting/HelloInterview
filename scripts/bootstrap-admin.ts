import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { prismaClient, prismaConnection } from '../server/db/prisma';
import { assertDatabaseVersion } from '../server/db/migrations';
import { hashPassword, validatePasswordPolicy } from '../server/account-admission/passwords';
import { isValidEmail, normalizeEmail } from '../server/account-admission/policy';
import { currentStaffRoles } from '../server/next/staff';
import { appendStaffRole } from '../server/staff';

interface BootstrapAdminArgs {
  email: string;
  name?: string;
  password?: string;
  passwordStdin: boolean;
}

function parseCliArgs(argv: string[]): BootstrapAdminArgs {
  let email = process.env.BOOTSTRAP_ADMIN_EMAIL || '';
  let name = process.env.BOOTSTRAP_ADMIN_NAME || '';
  let password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  let passwordStdin = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--email' && argv[i + 1]) {
      email = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
    } else if (arg === '--name' && argv[i + 1]) {
      name = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    } else if (arg === '--password' && argv[i + 1]) {
      password = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--password=')) {
      password = arg.slice('--password='.length);
    } else if (arg === '--password-stdin') {
      passwordStdin = true;
    }
  }

  return {
    email,
    name: name || undefined,
    password: password || undefined,
    passwordStdin,
  };
}

async function readStdinPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

export async function bootstrapAdminAccount(input: {
  email: string;
  name?: string;
  password?: string;
}): Promise<{
  userId: string;
  email: string;
  created: boolean;
  passwordUpdated: boolean;
  roleGranted: boolean;
}> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!isValidEmail(normalizedEmail)) {
    throw new Error(`Invalid administrator email address: "${input.email}"`);
  }

  let passwordHash: string | null = null;
  if (input.password !== undefined && input.password.length > 0) {
    const check = validatePasswordPolicy(input.password);
    if (!check.ok) {
      throw new Error(check.message);
    }
    passwordHash = await hashPassword(check.value);
  }

  const db = prismaConnection();
  await assertDatabaseVersion(db);

  const client = prismaClient();
  const existingAccount = await client.managed_accounts.findFirst({
    where: {
      contact_email: {
        equals: normalizedEmail,
        mode: 'insensitive',
      },
    },
    include: { users: true },
  });
  const existingUser =
    existingAccount?.users ??
    (await client.users.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
    }));

  if (!existingUser && !passwordHash) {
    throw new Error(
      'New administrator account requires a password (--password-stdin or BOOTSTRAP_ADMIN_PASSWORD).',
    );
  }

  const displayName =
    input.name?.trim() || existingUser?.name || normalizedEmail.split('@')[0] || 'Studio Admin';

  let userId: string;
  let created = false;
  let passwordUpdated = false;

  if (existingUser) {
    userId = existingUser.id;
    await client.$transaction(async tx => {
      await tx.users.update({
        where: { id: userId },
        data: {
          name: displayName,
          email: normalizedEmail,
        },
      });
      await tx.user_settings.upsert({
        where: { user_id: userId },
        create: { user_id: userId },
        update: {},
      });
      const existingIdentity = await tx.managed_identities.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'asc' },
      });
      const identityId = existingIdentity?.id ?? randomUUID();
      if (!existingIdentity) {
        await tx.managed_identities.create({
          data: {
            id: identityId,
            user_id: userId,
            issuer: 'studio:password',
            subject: userId,
            provider: 'email',
            email: normalizedEmail,
            verified: 1,
            available: 1,
          },
        });
      }
      await tx.managed_accounts.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          status: 'active',
          contact_email: normalizedEmail,
          contact_identity_id: identityId,
          contact_verified: 1,
        },
        update: {
          status: 'active',
          contact_email: normalizedEmail,
          contact_verified: 1,
        },
      });
      if (passwordHash) {
        const now = new Date();
        await tx.password_credentials.upsert({
          where: { user_id: userId },
          create: {
            id: randomUUID(),
            user_id: userId,
            password_hash: passwordHash,
            password_changed_at: now,
            created_at: now,
            updated_at: now,
          },
          update: {
            password_hash: passwordHash,
            password_changed_at: now,
            reset_token_hash: null,
            reset_expires_at: null,
            updated_at: now,
          },
        });
        passwordUpdated = true;
      }
    });
  } else {
    userId = randomUUID();
    const identityId = randomUUID();
    const now = new Date();
    created = true;
    passwordUpdated = true;
    await client.$transaction(async tx => {
      await tx.users.create({
        data: {
          id: userId,
          name: displayName,
          email: normalizedEmail,
          password: null,
          demo: 0,
        },
      });
      await tx.user_settings.create({
        data: { user_id: userId },
      });
      await tx.managed_identities.create({
        data: {
          id: identityId,
          user_id: userId,
          issuer: 'studio:password',
          subject: userId,
          provider: 'email',
          email: normalizedEmail,
          verified: 1,
          available: 1,
        },
      });
      await tx.managed_accounts.create({
        data: {
          user_id: userId,
          status: 'active',
          contact_email: normalizedEmail,
          contact_identity_id: identityId,
          contact_verified: 1,
        },
      });
      await tx.password_credentials.create({
        data: {
          id: randomUUID(),
          user_id: userId,
          password_hash: passwordHash!,
          password_changed_at: now,
          created_at: now,
          updated_at: now,
        },
      });
    });
  }

  const activeRoles = await currentStaffRoles(db, userId);
  let roleGranted = false;
  if (!activeRoles.includes('administrator')) {
    const endsAt = new Date(Date.now() + 89 * 86_400_000).toISOString();
    await appendStaffRole(db, {
      userId,
      role: 'administrator',
      state: 'granted',
      actorRef: 'bootstrap-admin',
      reason: 'Bootstrap administrator account and grant 90-day administrator role.',
      endsAt,
    });
    roleGranted = true;
  }

  return {
    userId,
    email: normalizedEmail,
    created,
    passwordUpdated,
    roleGranted,
  };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.email) {
    console.error(
      'Usage: npm run bootstrap:admin -- --email <admin@example.com> [--name "Admin"] [--password-stdin]',
    );
    process.exit(1);
  }
  const password = args.passwordStdin ? await readStdinPassword() : args.password;
  const result = await bootstrapAdminAccount({
    email: args.email,
    name: args.name,
    password,
  });
  console.log(JSON.stringify({ event: 'admin.bootstrapped', ...result }, null, 2));
  await prismaConnection().close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
