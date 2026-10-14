import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  typescript: {
    tsconfigPath: 'tsconfig.next.json',
  },
};

export default config;
