import { DurableJobs, postgresConnection } from '../../dist-server/jobs/index.js';

const db = postgresConnection(process.env.TEST_DATABASE_URL);
let jobs;
async function main() {
  jobs = await DurableJobs.open(db, true);
  await jobs.startWorkers({
    'notification.deliver': async (operation, signal) => {
      const response = await fetch(process.env.JOB_FIXTURE_PROVIDER, {
        method: 'POST', signal,
        headers: { 'Idempotency-Key': operation.id },
      });
      if (!response.ok) throw new Error('Synthetic provider rejected its request.');
      const receipt = await response.json();
      process.send({ type: 'provider-success', operationId: operation.id });
      if (process.env.JOB_FIXTURE_HALT === 'true') await new Promise(() => {});
      return async connection => {
        await connection.prepare('UPDATE fixture_effects SET count=count+1 WHERE id=?').run('counter');
        return receipt;
      };
    },
  });
  process.send({ type: 'ready' });
}
let stopping = false;
process.on('SIGTERM', () => {
  if (stopping) return;
  stopping = true;
  void (async () => {
    try { if (jobs) await jobs.close(); }
    finally { await db.close(); }
  })().catch(() => { console.error('Synthetic worker shutdown failed.'); process.exitCode = 1; });
});
void main().catch(async () => {
  console.error('Synthetic worker startup failed.');
  try { if (jobs) await jobs.close(); }
  finally { await db.close(); }
  process.exitCode = 1;
});
