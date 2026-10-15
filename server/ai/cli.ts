import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { loadManagedAiConfig } from './config';
import { ManagedAiWorker } from './worker';
import { prismaConnection } from '../db/prisma';
import { assertDatabaseVersion } from '../db/migrations';

export async function runManagedAiCommand(command: string) {
  if (!['process', 'worker'].includes(command)) throw new Error('Choose managed AI process or worker.');
  const config = loadManagedAiConfig();
  if (!config) throw new Error('Managed AI processing requires the complete explicit provider, pricing and data-use configuration.');
  const db = prismaConnection(), shutdown = new AbortController();
  let worker: ManagedAiWorker | undefined;
  const stop = () => shutdown.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await assertDatabaseVersion(db);
    worker = await ManagedAiWorker.open(db, config);
    let completed = 0;
    while (!shutdown.signal.aborted) {
      const result = await worker.processNext(shutdown.signal);
      if (result) {
        completed += 1;
      } else if (command === 'process') {
        console.log(JSON.stringify({ event: 'managed-ai.operations.processed', completed }));
        return;
      } else {
        try {
          await delay(1000, undefined, { signal: shutdown.signal });
        } catch (error) {
          if (!shutdown.signal.aborted) throw error;
        }
      }
    }
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    try {
      await worker?.close();
    } finally {
      await db.close();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runManagedAiCommand(process.argv[2] ?? '').catch(() => {
    console.error('Managed AI processing failed. Inspect private queue, provider and reconciliation diagnostics; no result or zero-cost outcome was assumed.');
    process.exitCode = 1;
  });
}
