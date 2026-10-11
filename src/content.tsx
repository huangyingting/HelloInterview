import { useEffect, useState } from 'react';
import { request, useStudio } from './store';

export function useContent<T>(url: string | null) {
  const { data } = useStudio();
  const key = `${url}|${data.user?.id ?? 'anonymous'}|${data.state.plan}|${data.state.planExpiresAt}`;
  const [result, setResult] = useState<{ key: string; value: T | null; error: string }>({ key: '', value: null, error: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setResult({ key, value: null, error: '' });
    if (url) request<T>(url, undefined, undefined, abort.signal).then(value => {
      if (!abort.signal.aborted) setResult({ key, value, error: '' });
    }).catch(error => {
      if (!abort.signal.aborted) setResult({ key, value: null, error: error instanceof Error ? error.message : 'Content could not be loaded.' });
    });
    return () => abort.abort();
  }, [url, key, retry]);
  return { value: result.key === key ? result.value : null, error: result.key === key ? result.error : '', reload: () => setRetry(value => value + 1) };
}
export function ContentStatus({ error, reload }: { error: string; reload: () => void }) {
  return <div className="panel" role={error ? 'alert' : 'status'}><p>{error || 'Loading saved content…'}</p>{error && <button className="button secondary small" onClick={reload}>Try again</button>}</div>;
}
