import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Bootstrap, UserState } from '../shared/types';
import { emptyState } from '../shared/domain';

export async function request<T>(url: string, data?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: method || (data === undefined ? 'GET' : 'POST'),
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}
interface Store {
  data: Bootstrap;
  loading: boolean;
  pending: boolean;
  error: string;
  toast: { text: string; error: boolean } | null;
  refresh: () => Promise<void>;
  setState: (state: UserState) => void;
  act: (operation: () => Promise<void>) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}
const Context = createContext<Store | null>(null);
export function StudioProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap>({ user: null, state: emptyState(), capabilities: { ai: false, commerce: 'demo', community: 'local', aiModel: null } });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [operations, setOperations] = useState(0);
  const [toast, setToast] = useState<Store['toast']>(null);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const refresh = useCallback(async () => {
    setData(await request<Bootstrap>('/api/bootstrap'));
    setError('');
  }, []);
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
  return <Context.Provider value={{ data, loading, error, pending: operations > 0, toast, refresh, setState: state => setData(current => ({ ...current, state })), act, notify }}>{children}</Context.Provider>;
}
export function useStudio() {
  const context = useContext(Context);
  if (!context) throw new Error('StudioProvider is missing.');
  return context;
}
