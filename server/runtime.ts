import { createServer, type Server } from 'node:http';
import { createApplication } from './application';
import type { ServerConfig } from './config';

export interface RunningServer {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const application = await createApplication(config);
  const server = createServer(application.app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    try {
      await application.close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Server startup and cleanup failed.');
    }
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    await application.close();
    throw new Error('The Studio did not receive a TCP listening address.');
  }
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return closing ??= (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(() => {
            console.error('Shutdown exceeded the 10-second grace period; closing remaining connections.');
            server.closeAllConnections();
          }, 10000);
          server.close(error => {
            clearTimeout(deadline);
            if (error) reject(error);
            else resolve();
          });
        });
      } finally {
        await application.close();
      }
    })();
  }
  return { server, url: `http://${host}:${address.port}`, close };
}
