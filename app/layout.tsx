import type { Metadata, Viewport } from 'next';
import '../src/styles.css';

export const metadata: Metadata = {
  title: 'Interview Studio',
  description: 'Original, practical engineering interview preparation with interactive lessons, guided practice, quizzes, and community learning.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f6f5f0',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="preload" href="/fonts/mona-sans.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head><body><div id="root">{children}</div></body></html>;
}
