import { loadConfig } from '../config';
import { postgresConnection } from './connection';
import { migrateDatabase } from './migrations';
import { applyLegacyImport, inspectLegacyImport } from './legacy-import';
import { DurableJobs, migrateJobs } from '../jobs';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'migrate' && args.length === 0) {
    const config = loadConfig();
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required for controlled PostgreSQL migrations.');
    const db = postgresConnection(config.databaseUrl);
    try {
      await migrateDatabase(db);
      await migrateJobs(db);
      console.log('PostgreSQL migrations applied and checksums verified; durable queues installed for this release.');
    } finally { await db.close(); }
    return;
  }
  if (command === 'jobs') {
    const [operation, ...options] = args;
    let id: string | undefined, actor: string | undefined, reason: string | undefined, reconciled = false;
    if (operation === 'replay') {
      id = options.shift();
      for (let index = 0; index < options.length; index++) {
        const flag = options[index];
        if (flag === '--provider-reconciled' && !reconciled) { reconciled = true; continue; }
        const value = options[++index];
        if (!value || value.startsWith('--')) throw new Error('Every replay option requires a value.');
        if (flag === '--actor' && !actor) actor = value;
        else if (flag === '--reason' && !reason) reason = value;
        else throw new Error('Invalid or duplicate replay option.');
      }
      if (!id || !actor || !reason) throw new Error('Replay requires an operation ID, --actor <operator-id>, and --reason <reconciliation-notes>.');
    } else if (operation !== 'status' || options.length) throw new Error('Usage: jobs status | jobs replay <operation-id> --actor <operator-id> --reason <notes> [--provider-reconciled]');
    const config = loadConfig();
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required for durable-job maintenance.');
    const db = postgresConnection(config.databaseUrl);
    let jobs: DurableJobs | undefined;
    try {
      jobs = await DurableJobs.open(db);
      if (operation === 'replay') {
        const replayed = await jobs.replay(id!, actor!, reason!, reconciled);
        console.log(JSON.stringify({ id: replayed.id, jobId: replayed.jobId, generation: replayed.generation }, null, 2));
      } else console.log(JSON.stringify({ operations: await jobs.inspect(), deadLetters: await jobs.deadLetters() }, null, 2));
    } finally {
      try { if (jobs) await jobs.close(); } finally { await db.close(); }
    }
    return;
  }
  if (command === 'import') {
    let source: string | undefined, approved: string | undefined;
    const users: string[] = [];
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index], value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Every import option requires a value.');
      if (flag === '--source' && !source) source = value;
      else if (flag === '--user') users.push(value);
      else if (flag === '--apply' && !approved && /^[a-f0-9]{64}$/.test(value)) approved = value;
      else throw new Error('Invalid or duplicate import option.');
    }
    if (!source) throw new Error('Specify --source with an owner-approved, decrypted maintenance backup and --user for every approved non-demo account. The default is a read-only dry run.');
    const input = inspectLegacyImport(source, users);
    if (approved) {
      const config = loadConfig();
      if (!config.databaseUrl) throw new Error('DATABASE_URL is required to apply a legacy import.');
      const db = postgresConnection(config.databaseUrl);
      try { await applyLegacyImport(db, input, approved); } finally { await db.close(); }
    }
    console.log(JSON.stringify({ mode: approved ? 'applied' : 'dry-run', ...input.report }, null, 2));
    return;
  }
  throw new Error('Usage: db migrate | db import --source <backup.sqlite> --user <approved-id> [--apply <fingerprint>] | jobs status | jobs replay <operation-id> --actor <operator-id> --reason <notes> [--provider-reconciled]');
}

main().catch((error: unknown) => {
  const safe = error instanceof Error && !('code' in error) && !['ZodError', 'SyntaxError'].includes(error.name) ? error.message : 'Database command failed. Check connectivity, constraints, and backup validation; no credentials are logged.';
  console.error(`Database operation failed: ${safe}`);
  process.exitCode = 1;
});
