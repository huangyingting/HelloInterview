import { loadConfig } from '../config';
import { postgresConnection } from './connection';
import { migrateDatabase } from './migrations';
import { applyLegacyImport, inspectLegacyImport } from './legacy-import';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'migrate' && args.length === 0) {
    const config = loadConfig();
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required for controlled PostgreSQL migrations.');
    const db = postgresConnection(config.databaseUrl);
    try {
      await migrateDatabase(db);
      console.log('PostgreSQL migrations applied and checksums verified.');
    } finally { await db.close(); }
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
  throw new Error('Usage: db migrate | db import --source <backup.sqlite> --user <approved-id> [--user <approved-id>] [--apply <dry-run-fingerprint>]');
}

main().catch((error: unknown) => {
  const safe = error instanceof Error && !('code' in error) && !['ZodError', 'SyntaxError'].includes(error.name) ? error.message : 'Database command failed. Check connectivity, constraints, and backup validation; no credentials are logged.';
  console.error(`Database operation failed: ${safe}`);
  process.exitCode = 1;
});
