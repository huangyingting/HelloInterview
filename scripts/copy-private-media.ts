import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist-server/media', { recursive: true });
for (const file of ['concurrency.webm', 'concurrency.vtt']) {
  await cp(`server/media/${file}`, `dist-server/media/${file}`);
}
