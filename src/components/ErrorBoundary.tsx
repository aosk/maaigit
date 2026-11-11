import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a screen that failed to draw, so one broken card never leaves a blank white page: the user sees what
 * happened and can reload, and the rest of the app (the tabs, the Stop button on another screen) stays reachable.
 * `resetKey` clears the error when it changes (moving to another screen tries again).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A screen failed to draw:', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const ar = document.documentElement.lang === 'ar';
    return (
      <div className="screen" role="alert">
        <div className="error" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <span>{ar ? 'صار خطأ في عرض هذي الشاشة. بياناتك سليمة.' : 'This screen could not be shown. Your data is safe.'}</span>
          <button type="button" className="btn secondary" onClick={() => window.location.reload()}>{ar ? 'أعد التحميل' : 'Reload'}</button>
        </div>
      </div>
    );
  }
}
