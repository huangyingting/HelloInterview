import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'private-content-boundary',
    moduleParsed(module) {
      const id = module.id.split('?')[0].replaceAll('\\', '/');
      if (/\/server\//.test(id) || /\/shared\/(catalog|courses)\.ts$/.test(id)
        || /\/shared\/content\//.test(id) && !id.endsWith('/sources.ts')) {
        this.error(`Private server content cannot enter the browser graph: ${id}`);
      }
    },
  }],
  server: {
    host: '127.0.0.1',
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.cred*', '**/data/**', '**/server/**', '**/shared/catalog.ts', '**/shared/courses.ts', '**/shared/content/*-*.ts'] },
  },
});
