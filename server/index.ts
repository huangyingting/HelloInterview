import { loadConfig } from './config';
import { startServer } from './runtime';

async function main() {
  const runtime = await startServer(loadConfig());
  console.log(`Interview Studio is running at ${runtime.url}`);
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    void runtime.close().then(
      () => { process.exitCode = 0; },
      error => {
        console.error('Studio shutdown failed:', error instanceof Error ? error.message : 'Unknown error');
        process.exitCode = 1;
      },
    );
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch(error => {
  console.error('Studio startup failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
