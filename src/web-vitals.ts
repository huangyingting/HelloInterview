import { fieldScreen, navigationTypes, type NavigationType, type WebVitalName } from '../shared/web-vitals';

interface LayoutShiftEntry extends PerformanceEntry { value: number; hadRecentInput: boolean }
interface InteractionEntry extends PerformanceEntry { duration: number; interactionId: number }

export function startFieldMetrics() {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const screen = fieldScreen(window.location.pathname);
  const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const navigation: NavigationType = navigationTypes.includes(navigationEntry?.type as NavigationType) ?
    navigationEntry!.type as NavigationType : 'navigate';
  const reported = new Set<WebVitalName>(), observers: PerformanceObserver[] = [];
  let lcp: number | null = null, cls = 0;
  const interactions = new Map<number, number>();

  function send(metric: WebVitalName, value: number) {
    if (reported.has(metric) || !Number.isFinite(value) || value < 0) return;
    reported.add(metric);
    const body = JSON.stringify({ metric, value, screen, navigation });
    if (navigator.sendBeacon?.('/api/metrics/web-vitals', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/api/metrics/web-vitals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
    }).then(response => {
      if (!response.ok) console.warn(`Field metric delivery was rejected (${response.status}).`);
    }, () => console.warn('Field metric delivery failed.'));
  }
  function observe(type: string, callback: PerformanceObserverCallback) {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    try {
      const observer = new PerformanceObserver(callback);
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch (error) {
      console.warn(`Field metric observer ${type} is unavailable.`, error instanceof Error ? error.name : 'Unknown error');
    }
  }
  observe('largest-contentful-paint', list => {
    const entry = list.getEntries().at(-1);
    if (entry) lcp = entry.startTime;
  });
  observe('layout-shift', list => {
    for (const entry of list.getEntries() as LayoutShiftEntry[]) if (!entry.hadRecentInput) cls += entry.value;
  });
  observe('event', list => {
    for (const entry of list.getEntries() as InteractionEntry[]) {
      if (entry.interactionId > 0) interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration));
    }
  });
  function flush() {
    if (lcp !== null) send('LCP', lcp);
    if (cls > 0) send('CLS', cls);
    if (interactions.size) {
      const values = [...interactions.values()].sort((a, b) => b - a);
      send('INP', values[Math.min(values.length - 1, Math.floor(values.length / 50))]);
    }
  }
  const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', flush);
  return () => {
    observers.forEach(observer => observer.disconnect());
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', flush);
  };
}
