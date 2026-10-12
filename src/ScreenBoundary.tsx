import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function ScreenLoading() {
  return <section className="empty" role="status" aria-label="Loading screen" aria-live="polite" aria-busy="true">
    <h1>Loading this screen...</h1><p>Your Studio stays open while this screen loads.</p>
  </section>;
}

export class ScreenBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    console.error('Studio screen failed to load or render.', { error: error.name });
  }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="empty">
      <h1>This screen could not open.</h1>
      <p role="alert">A loading or display error stopped this screen. No action was retried and the page was not automatically reloaded.</p>
      <button className="button" onClick={() => window.location.reload()}>Reload page</button>
      <p className="fine-print">Reloading may discard unsaved changes on this page.</p>
      <Link className="text-link" to="/">Back to the Studio</Link>
    </section>;
  }
}
