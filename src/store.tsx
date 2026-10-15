import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Bootstrap, UserState } from '../shared/types';
import { emptyState } from '../shared/domain';
import { canUse, proCapabilities, type Capability } from '../shared/access';

let csrfToken: string | undefined;
let fieldMetricsStarted=false;
export interface ManagedAiReceipt {
  operationId: string;
  reservationId: string;
  state: 'queued';
}
export interface ManagedAiStatus {
  operationId: string;
  kind: 'tutor' | 'feedback' | 'mock' | 'project';
  state: 'queued' | 'running' | 'unknown' | 'completed' | 'cancelled' | 'failed';
  createdAt: string;
  completedAt: string | null;
  result?: { sourceId: string | null; revision: number | null };
}
export async function request<T>(url: string, data?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const verb = method || (data === undefined ? 'GET' : 'POST');
  const response = await fetch(url, {
    method: verb,
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(!['GET', 'HEAD'].includes(verb) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  if (url === '/api/bootstrap') csrfToken = payload && typeof payload === 'object' && 'csrf' in payload && typeof payload.csrf === 'string' ? payload.csrf : undefined;
  return payload as T;
}
export async function waitForManagedAi(operationId: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    signal?.throwIfAborted();
    if (attempt) await new Promise<void>((resolve, reject) => {
      const aborted = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', aborted);
        reject(signal?.reason);
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', aborted);
        resolve();
      }, 2000);
      signal?.addEventListener('abort', aborted, { once: true });
    });
    const status = await request<ManagedAiStatus>(`/api/ai/operations/${encodeURIComponent(operationId)}`, undefined, 'GET', signal);
    if (status.state === 'completed') return status;
    if (status.state === 'unknown') throw new Error('The provider outcome is unknown. Your saved work is unchanged and support can reconcile this request.');
    if (status.state === 'cancelled') throw new Error('The request was cancelled before provider dispatch. Your saved work is unchanged.');
    if (status.state === 'failed') throw new Error('The managed AI request could not run. Your saved work is unchanged.');
  }
  throw new Error('Feedback is still queued. Your saved work is safe; return later to refresh its status.');
}
interface Store {
  data: Bootstrap;
  loading: boolean;
  pending: boolean;
  error: string;
  toast: { text: string; error: boolean } | null;
  refresh: (fresh?: boolean) => Promise<void>;
  setState: (state: UserState) => void;
  act: (operation: () => Promise<void>) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  can: (capability: Capability) => boolean;
}
const Context = createContext<Store | null>(null);
export function StudioProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap>({ user: null, state: emptyState(), capabilities: { ai: false, commerce: 'demo', community: 'local', aiModel: null, fieldMetrics: false } });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [operations, setOperations] = useState(0);
  const [toast, setToast] = useState<Store['toast']>(null);
  const accessClock = useRef<{ server: number; received: number } | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  const [accessTick, setAccessTick] = useState(0);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const refresh = useCallback(async (fresh = false) => {
    if (refreshing.current) {
      if (!fresh) return refreshing.current;
      await refreshing.current;
    }
    if (refreshing.current) return refreshing.current;
    refreshing.current = (async () => {
      const next = await request<Bootstrap>('/api/bootstrap');
      if(next.capabilities.fieldMetrics&&!fieldMetricsStarted){
        fieldMetricsStarted=true;
        void import('./web-vitals').then(module=>module.startFieldMetrics(),()=>{fieldMetricsStarted=false;console.warn('Field metrics are unavailable.');});
      }
      accessClock.current = next.capabilities.access ? { server: Date.parse(next.capabilities.access.serverTime), received: performance.now() } : null;
      setData(next);
      setError('');
    })().finally(() => { refreshing.current = null; });
    return refreshing.current;
  }, []);
  const can = useCallback((capability: Capability) => {
    const clock = accessClock.current;
    return canUse(data, capability, clock ? clock.server + performance.now() - clock.received : Date.now());
  }, [data, accessTick]);
  const refreshAccess = useCallback(() => {
    setAccessTick(value => value + 1);
    void refresh().catch(err => {
      setData(current => {
        const access = current.capabilities.access;
        if (!access) return current;
        return { ...current, capabilities: { ...current.capabilities, access: { ...access,
          features: access.features.map(feature => proCapabilities.includes(feature.key) ? { ...feature, allowed: false, reason: 'unavailable' } : feature),
        } } };
      });
      notify(err instanceof Error ? err.message : 'Could not refresh current access. Saved work is unchanged.', true);
    });
  }, [refresh, notify]);
  useEffect(() => {
    const access = data.capabilities.access, clock = accessClock.current;
    if (!access?.nextChangeAt || !clock) return;
    const delay = Date.parse(access.nextChangeAt) - clock.server - (performance.now() - clock.received);
    const timeout = setTimeout(refreshAccess, Math.max(0, Math.min(2147483647, delay + 1)));
    return () => clearTimeout(timeout);
  }, [data.capabilities.access?.serverTime, data.capabilities.access?.nextChangeAt, refreshAccess]);
  useEffect(() => {
    if (data.capabilities.auth?.mode !== 'managed') return;
    const focus = () => { if (!document.hidden) refreshAccess(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [data.capabilities.auth?.mode, refreshAccess]);
  useEffect(() => {
    refresh().catch(err => setError(err instanceof Error ? err.message : 'Could not load your account.')).finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), toast.error ? 10000 : 4000);
    return () => clearTimeout(timeout);
  }, [toast]);
  const act = useCallback(async (operation: () => Promise<void>) => {
    setOperations(value => value + 1);
    try { await operation(); }
    catch (err) { notify(err instanceof Error ? err.message : 'The operation failed. Please try again.', true); }
    finally { setOperations(value => value - 1); }
  }, [notify]);
  return <Context.Provider value={{ data, loading, error, pending: operations > 0, toast, refresh, can, setState: state => setData(current => ({ ...current, state })), act, notify }}>{children}</Context.Provider>;
}
export function useStudio() {
  const context = useContext(Context);
  if (!context) throw new Error('StudioProvider is missing.');
  return context;
}
