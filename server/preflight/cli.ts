import { pathToFileURL } from 'node:url';
import { ConfigurationError, loadConfig, privateBetaDurabilityNotice, type ServerConfig } from '../config';
import { postgresConnection } from '../db/connection';
import { assertDatabaseVersion } from '../db/migrations';
import { inspectMaintainedJobs } from '../jobs';

export async function runServicePreflight(config: ServerConfig = loadConfig()) {
  if (config.appMode !== 'service' || !config.databaseUrl || !config.identity?.lifecycle || !config.participantPolicy) {
    throw new Error('Service preflight requires the complete service-mode configuration.');
  }
  const db = postgresConnection(config.databaseUrl);
  try {
    await assertDatabaseVersion(db);
    const queue = await inspectMaintainedJobs(db);
    const migration = await db.prepare('SELECT count(*)::integer AS count,max(version)::integer AS latest FROM schema_migrations').get();
    if (typeof migration?.count !== 'number' || typeof migration.latest !== 'number') {
      throw new Error('Migration statistics are unavailable.');
    }
    return {
      event: 'service.preflight.ready',
      mode: config.appMode,
      listener: { loopback: ['127.0.0.1', '::1', 'localhost'].includes(config.host), port: config.port },
      trustedProxyCount: config.trustedProxies.length,
      identity: {
        providers: Object.keys(config.identity.connections).sort(),
        lifecycle: true,
        inviteCount: config.identity.inviteEmailHashes?.length ?? 0,
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
      features: { ai: false, billing: false, community: 'read-only' },
    };
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runServicePreflight().then(result => console.log(JSON.stringify(result))).catch((error: unknown) => {
    const message = error instanceof ConfigurationError ? error.message :
      'Service preflight failed. Check root-only configuration, database migrations, and queue health; no credentials are logged.';
    console.error(message);
    process.exitCode = 1;
  });
}
