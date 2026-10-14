import { Component, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link } from './navigation';

interface ScreenFocusProps { focusKey: string; onReady: () => void }
interface ScreenBoundaryProps extends ScreenFocusProps { children: ReactNode; resetKey: string }
interface ScreenBoundaryState { failed: boolean; resetKey: string }

export function useScreenFocus(path: string, owner: string | undefined, ready: boolean) {
  const focusKey = JSON.stringify([path, owner ?? null]);
  const previous = useRef<string | null>(null), request = useRef<{ element: Element | null } | null>(null);
  useLayoutEffect(() => {
    if (!ready) return;
    if (previous.current !== null && previous.current !== focusKey) request.current = { element: document.activeElement };
    previous.current = focusKey;
  }, [focusKey, ready]);
  const onReady = useCallback(() => {
    const origin = request.current;
    if (!origin) return;
    request.current = null;
    const main = document.getElementById('main'), active = document.activeElement;
    if (main && !main.contains(active) && (active === origin.element || active === document.body)) main.focus({ preventScroll: true });
  }, []);
  return { focusKey, onReady };
}

export function ScreenReady({ children, focusKey, onReady }: ScreenFocusProps & { children: ReactNode }) {
  useEffect(onReady, [focusKey, onReady]);
  return <>{children}</>;
}

export function ScreenLoading() {
  return <section className="empty" role="status" aria-label="Loading screen" aria-live="polite" aria-busy="true">
    <h1>Loading this screen...</h1><p>Your Studio stays open while this screen loads.</p>
  </section>;
}

export class ScreenBoundary extends Component<ScreenBoundaryProps, ScreenBoundaryState> {
  state = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromProps(props: ScreenBoundaryProps, previous: ScreenBoundaryState) {
    return previous.resetKey === props.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    console.error('Studio screen failed to load or render.', { error: error.name });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <ScreenReady focusKey={this.props.focusKey} onReady={this.props.onReady}><section className="empty">
      <h1>This screen could not open.</h1>
      <p role="alert">A loading or display error stopped this screen. No action was retried and the page was not automatically reloaded.</p>
      <button className="button" onClick={() => window.location.reload()}>Reload page</button>
      <p className="fine-print">Reloading may discard unsaved changes on this page.</p>
      <Link className="text-link" to="/">Back to the Studio</Link>
    </section></ScreenReady>;
  }
}
