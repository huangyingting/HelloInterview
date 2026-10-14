export const webVitalNames = ['LCP', 'CLS', 'INP'] as const;
export const fieldScreens = ['landing', 'auth', 'dashboard', 'learning', 'practice', 'quiz', 'community',
  'account', 'billing', 'staff', 'premium', 'support', 'information', 'other'] as const;
export const navigationTypes = ['navigate', 'reload', 'back-forward', 'prerender'] as const;
export type WebVitalName = typeof webVitalNames[number];
export type FieldScreen = typeof fieldScreens[number];
export type NavigationType = typeof navigationTypes[number];
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export function fieldScreen(pathname: string): FieldScreen {
  const first = pathname.split('/')[1] ?? '';
  if (!first) return 'landing';
  if (['login', 'auth'].includes(first)) return 'auth';
  if (first === 'dashboard') return 'dashboard';
  if (['learn', 'guides', 'blog'].includes(first)) return 'learning';
  if (['practice', 'history'].includes(first)) return 'practice';
  if (first === 'quiz') return 'quiz';
  if (first === 'community') return 'community';
  if (['profile', 'account', 'settings'].includes(first)) return 'account';
  if (first === 'billing') return 'billing';
  if (first === 'staff') return 'staff';
  if (['pricing', 'premium'].includes(first)) return 'premium';
  if (['support', 'faq'].includes(first)) return 'support';
  if (['aboutus', 'privacy', 'terms', 'security'].includes(first)) return 'information';
  return 'other';
}

export function normalizeWebVital(metric: WebVitalName, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > (metric === 'CLS' ? 10 : 120000)) return null;
  return metric === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value / 10) * 10;
}

export function webVitalRating(metric: WebVitalName, value: number): WebVitalRating {
  if (metric === 'LCP') return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor';
  if (metric === 'CLS') return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor';
  return value <= 200 ? 'good' : value <= 500 ? 'needs-improvement' : 'poor';
}
