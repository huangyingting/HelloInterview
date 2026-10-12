import { PgBoss, type Queue } from 'pg-boss';
import type { Database } from '../db/connection';
import { assertDatabaseVersion } from '../db/migrations';
import { deadLetterQueue, jobKinds, queueNames } from './schema';

export const queuePolicy: Omit<Queue, 'name'> = {
  policy: 'singleton', retryLimit: 3, retryDelay: 5, retryBackoff: true, retryDelayMax: 300,
  expireInSeconds: 300, heartbeatSeconds: 30, retentionSeconds: 1209600,
  deleteAfterSeconds: 604800, deadLetter: deadLetterQueue,
};
export async function createBoss(db: Database, maintenance = false, worker = false): Promise<PgBoss> {
  if (db.dialect !== 'postgres') throw new Error('Durable jobs require PostgreSQL; local synchronous workflows are unchanged.');
  await assertDatabaseVersion(db);
  const row = await db.prepare('SELECT current_schema() AS schema').get();
  if (typeof row?.schema !== 'string' || !/^[a-z_][a-z0-9_]{0,44}$/.test(row.schema)) {
    throw new Error('Durable jobs require a lowercase application schema of at most 45 characters.');
  }
  const boss = new PgBoss({
    db, schema: `${row.schema}_jobs`, migrate: maintenance, createSchema: maintenance,
    supervise: worker, schedule: false, registerInstance: worker,
    instanceName: worker ? 'studio-worker' : undefined,
    reindex: false, monitorIntervalSeconds: 10, superviseIntervalSeconds: 10,
    openTelemetry: { enabled: false, propagateContext: false },
  });
  boss.on('error', () => console.error('Durable job infrastructure failed; inspect database connectivity and queue health.'));
  boss.on('warning', () => console.error('Durable job infrastructure warning; inspect queue backlog and database maintenance.'));
  return boss;
}
export async function migrateJobs(db: Database): Promise<void> {
  const boss = await createBoss(db, true);
  try {
    await boss.start();
    await boss.createQueue(deadLetterQueue, { retryLimit: 0, deleteAfterSeconds: 604800, retentionSeconds: 1209600 });
    for (const kind of jobKinds) {
      await boss.createQueue(queueNames[kind], queuePolicy);
      const { policy, ...settings } = queuePolicy;
      const queue = await boss.getQueue(queueNames[kind]);
      if (!queue || queue.policy !== policy) throw new Error('A durable queue has an incompatible immutable concurrency policy.');
      await boss.updateQueue(queueNames[kind], settings);
    }
  } finally { await boss.stop(); }
}
export async function startBoss(db: Database, worker = false): Promise<PgBoss> {
  const boss = await createBoss(db, false, worker);
  try {
    if (!await boss.isInstalled()) throw new Error('The durable queue schema is missing. Run the controlled migration command.');
    for (const kind of jobKinds) {
      const queue = await boss.getQueue(queueNames[kind]);
      if (!queue || Object.entries(queuePolicy).some(([key, value]) => queue[key as keyof typeof queue] !== value)) {
        throw new Error('Durable queue policy does not match this release. Run the controlled migration command.');
      }
    }
    if (!await boss.getQueue(deadLetterQueue)) throw new Error('The durable dead-letter queue is missing.');
    await boss.start();
    return boss;
  } catch (error) {
    await boss.stop();
    throw error;
  }
}
