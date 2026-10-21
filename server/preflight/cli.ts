import { pathToFileURL } from 'node:url';
import { ManagedAiConfigurationError } from '../ai/config';
import { AuthConfigurationError, configuredSocialProviders } from '../auth/config';
import { communityParticipationEnabled } from '../next/capabilities';
import { loadAccountMailSender } from '../account-admission/mail-config';
import { prismaConnection } from '../db/prisma';
import { assertDatabaseVersion } from '../db/migrations';
import { inspectMaintainedJobs } from '../jobs';
import { privateBetaDurabilityNotice } from '../participant-policy';
import {
  loadServicePreflightConfig,
  ServicePreflightConfigurationError,
  type ServicePreflightConfig,
} from './config';

export async function runServicePreflight(config: ServicePreflightConfig = loadServicePreflightConfig()) {
  const db = prismaConnection();
  try {
    await assertDatabaseVersion(db);
    const synthetic = await db.prepare(`SELECT
      (SELECT count(*) FROM users WHERE demo=1) AS accounts,
      (SELECT count(*) FROM posts WHERE sample=1) AS posts`).get();
    if (Number(synthetic?.accounts) !== 0 || Number(synthetic?.posts) !== 0) {
      throw new Error('Demo-marked account or community records remain. Review the controlled data cleanup before serving.');
    }
    const queue = await inspectMaintainedJobs(db);
    const migration = await db.prepare('SELECT count(*)::integer AS count,max(version)::integer AS latest FROM schema_migrations').get();
    if (typeof migration?.count !== 'number' || typeof migration.latest !== 'number') {
      throw new Error('Migration statistics are unavailable.');
    }
    return {
      event: 'service.preflight.ready',
      mode: 'service',
      listener: { loopback: ['127.0.0.1', '::1', 'localhost'].includes(config.host), port: config.port },
      trustedProxyCount: config.trustedProxies.length,
      identity: {
        system: 'authjs',
        providers: configuredSocialProviders(config.auth),
        inviteCount: config.auth.inviteEmailHashes.length,
      },
      participantPolicy: {
        minimumAge: config.participantPolicy.minimumAge,
        contactProtocol: new URL(config.participantPolicy.contactUrl).protocol,
        noDurability: config.participantPolicy.durabilityNotice === privateBetaDurabilityNotice,
      },
      database: {
        migrationCount: migration.count,
        latestMigration: migration.latest,
        operationCount: queue.operationCount,
        maintainedQueueCount: queue.maintainedQueueCount,
      },
      features: {
        ai: Boolean(config.ai),
        billing: config.billing ? 'sandbox' : false,
        community: communityParticipationEnabled() ? 'managed' : 'read-only',
        accountEmail: Boolean(loadAccountMailSender()),
      },
    };
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runServicePreflight().then(result => console.log(JSON.stringify(result))).catch((error: unknown) => {
    const message = error instanceof ServicePreflightConfigurationError
      || error instanceof AuthConfigurationError
      || error instanceof ManagedAiConfigurationError ? error.message :
      'Service preflight failed. Check root-only configuration, database migrations, and queue health; no credentials are logged.';
    console.error(message);
    process.exitCode = 1;
  });
}
