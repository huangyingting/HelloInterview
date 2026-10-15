import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const staticTarget = path.join(standalone, '.next', 'static');
const publicTarget = path.join(standalone, 'public');
const privateMediaTarget = path.join(standalone, 'private-media');

await rm(path.join(standalone, 'data'), { recursive: true, force: true });
await rm(staticTarget, { recursive: true, force: true });
await mkdir(path.dirname(staticTarget), { recursive: true });
await cp(path.join(root, '.next', 'static'), staticTarget, { recursive: true });
await rm(publicTarget, { recursive: true, force: true });
await cp(path.join(root, 'public'), publicTarget, { recursive: true });
await rm(privateMediaTarget, { recursive: true, force: true });
await cp(path.join(root, 'server', 'media'), privateMediaTarget, { recursive: true });
