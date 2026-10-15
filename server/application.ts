import express from 'express';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createApp, handleError } from './app';
import type { ServerConfig } from './config';
import { localConnection, postgresConnection } from './db/connection';
import { assertDatabaseVersion } from './db/migrations';
import { IdentityLifecycle } from './identity/lifecycle';
import { assertBillingConfiguration, BillingNotifications } from './billing';
import { PrivacyExports } from './privacy';

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
      for(const retained of config.retainedFrontendDirs){
        let assets;
        try{assets=await stat(path.join(retained,'assets'));}
        catch(error){
          if(error instanceof Error&&'code' in error&&error.code==='ENOENT')throw new Error(`Retained frontend assets are missing: ${retained}`);
          throw error;
        }
        if(!assets.isDirectory())throw new Error(`Retained frontend assets must be a directory: ${retained}`);
      }
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
  let lifecycle: IdentityLifecycle | undefined;
  let billing: BillingNotifications | undefined;
  let privacy:PrivacyExports|undefined;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return closing ??= (async () => {
      shutdown.abort();
      draining.abort();
      try { await privacy?.close(); } finally {
        try { await billing?.close(); } finally {
          try { await lifecycle?.close(); } finally { await db.close(); }
        }
      }
    })();
  }
  try {
    await assertDatabaseVersion(db);
    await assertBillingConfiguration(db, config.billing);
    if (db.dialect === 'postgres' && !config.identity && await db.prepare('SELECT 1 AS present WHERE EXISTS(SELECT 1 FROM entitlement_grants) OR EXISTS(SELECT 1 FROM entitlement_revocations)').get()) {
      throw new Error('Stored managed entitlements require managed identity configuration. Local demo access is not a production fallback.');
    }
    if (db.dialect === 'postgres' && !config.identity?.lifecycle && await db.prepare('SELECT 1 AS present FROM identity_subject_security LIMIT 1').get()) {
      throw new Error('Stored identity security authority requires managed lifecycle configuration. Disabling it is not an authentication fallback.');
    }
    if (config.identity?.lifecycle) lifecycle = await IdentityLifecycle.open(db, config.identity, shutdown.signal);
    if (config.billing) billing = await BillingNotifications.open(db, config.billing, shutdown.signal, false, undefined, config.publicOrigin ?? undefined);
    if(config.identity)privacy=await PrivacyExports.open(db);
    const app = createApp(config, db, shutdown.signal, draining.signal, undefined, lifecycle, billing,privacy);
    if (config.environment === 'production') {
      const assetOptions={immutable:true,maxAge:'1y',index:false,fallthrough:true} as const;
      app.use('/assets',express.static(path.join(config.frontendDir,'assets'),assetOptions));
      for(const retained of config.retainedFrontendDirs)app.use('/assets',express.static(path.join(retained,'assets'),assetOptions));
      app.get('/assets/{*path}',(_req,res)=>res.status(404).type('text/plain').send('Asset not found.'));
      app.use(express.static(config.frontendDir));
      app.get('/{*path}', (_req, res) => res.sendFile(path.join(config.frontendDir, 'index.html')));
    }
    const addressError: express.ErrorRequestHandler = (error: unknown, req, res, next) => {
      if (config.environment === 'production' && error instanceof URIError && !res.headersSent &&
        req.method === 'GET' && req.get('Accept')?.includes('text/html') &&
        !['/api/', '/auth/', '/webhooks/', '/assets/', '/media/'].some(prefix => req.path.startsWith(prefix))) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(400).sendFile(path.join(config.frontendDir, 'index.html'), error => { if (error) next(error); });
      } else next(error);
    };
    app.use(addressError);
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
