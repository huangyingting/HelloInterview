import express from 'express';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { createApp, handleError } from './app';
import type { ServerConfig } from './config';
import { localConnection, postgresConnection } from './db/connection';
import { assertDatabaseVersion } from './db/migrations';

export interface Application {
  readonly app: express.Express;
  drain(): void;
  close(): Promise<void>;
}

export async function createApplication(config: ServerConfig): Promise<Application> {
  if (config.environment === 'production') {
    try {
      const frontend = await stat(path.join(config.frontendDir, 'index.html'));
      if (!frontend.isFile()) throw new Error('The production frontend index must be a file.');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error('The production frontend is missing. Run npm run build before npm start.');
      }
      throw error;
    }
  }
  const db = config.databaseUrl ? postgresConnection(config.databaseUrl) : localConnection(config.dataDir);
  const shutdown = new AbortController();
  const draining = new AbortController();
  let vite: ViteDevServer | undefined;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return closing ??= (async () => {
      shutdown.abort();
      draining.abort();
      try {
        await vite?.close();
      } finally {
        await db.close();
      }
    })();
  }
  try {
    await assertDatabaseVersion(db);
    const app = createApp(config, db, shutdown.signal, draining.signal);
    if (config.environment === 'production') {
      app.use(express.static(config.frontendDir));
      app.get('/{*path}', (_req, res) => res.sendFile(path.join(config.frontendDir, 'index.html')));
    } else {
      const { createServer } = await import('vite');
      vite = await createServer({ root: config.rootDir, server: { middlewareMode: true }, appType: 'spa' });
      app.use(vite.middlewares);
    }
    app.use(handleError);
    return { app, close, drain: () => { draining.abort(); } };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Application setup and cleanup failed.');
    }
    throw error;
  }
}
