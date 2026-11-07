import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Crash guard. Without it, one error while drawing a screen removes the whole interface and the
 * phone shows a black screen. With it, the rest of Noor keeps working and the screen offers a retry.
 * Errors are kept (last 15) so they can be shown in Settings › About and fixed.
 */

const LOG_KEY = 'noor.errors.v1';

export interface LoggedError {
  at: string;
  where: string;
  message: string;
  stack?: string;
}

export function logError(where: string, err: unknown) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const list = readErrors();
    list.unshift({ at: new Date().toISOString(), where, message: e.message.slice(0, 300), stack: e.stack?.slice(0, 1200) });
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, 15)));
  } catch {
    /* storage full / private */
  }
}

export function readErrors(): LoggedError[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as LoggedError[];
  } catch {
    return [];
  }
}

export function clearErrors() {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
}

/** Also record errors that never reach React (timers, promises). */
export function installGlobalErrorLog() {
  window.addEventListener('error', (e) => logError('window', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason));
}

interface Props {
  name: string;
  children: ReactNode;
  /** Full-screen fallback (the root guard). */
  full?: boolean;
  /** Changing this clears the error (e.g. switching tabs). */
  resetKey?: unknown;
  /** Pushed pages: offer a way back. */
  onBack?: () => void;
}

export class Guard extends Component<Props, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(p: Props, s: { error: Error | null; key: unknown }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError(this.props.name, Object.assign(error, { stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` }));
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={`n-guard ${this.props.full ? 'is-full' : ''}`} role="alert">
        <div className="n-guard__icon">!</div>
        <b>Something went wrong here</b>
        <p>The rest of Noor still works. This was saved so it can be fixed.</p>
        <small>{this.state.error.message}</small>
        <div className="n-guard__actions">
          <button className="n-btn n-btn--primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          {this.props.onBack ? (
            <button className="n-btn n-btn--ghost" onClick={this.props.onBack}>
              Go back
            </button>
          ) : (
            <button className="n-btn n-btn--ghost" onClick={() => window.location.reload()}>
              Restart Noor
            </button>
          )}
        </div>
      </div>
    );
  }
}
