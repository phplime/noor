import { useEffect, useRef } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from './Icon';

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="t-icon">
            <Icon name={t.kind === 'success' ? 'check' : t.kind === 'info' ? 'info' : 'alert'} size={16} />
          </span>
          <div className="t-body">
            <div className="t-title">{t.title}</div>
            {t.message && (
              <div className="muted" style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
                {t.message}
              </div>
            )}
            {(t.actions ?? (t.action ? [t.action] : [])).length > 0 && (
              <div className="t-actions">
                {(t.actions ?? [t.action!]).map((a, i) => (
                  <button
                    key={a.label}
                    className={`btn${i === 0 && t.actions ? ' primary' : ''}`}
                    onClick={() => {
                      a.run();
                      dismiss(t.id);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn ghost icon" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog() {
  const { confirmState: c } = useApp();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!c) return;
    // Destructive actions default focus to Cancel.
    (c.destructive ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        c.resolve(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c]);
  if (!c) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && c.resolve(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{c.title}</h2>
        <div className="muted">{c.message}</div>
        <div className="actions">
          <button ref={cancelRef} className="btn" onClick={() => c.resolve(false)}>
            {c.cancelLabel ?? 'Cancel'}
          </button>
          {c.extra?.map((x) => (
            <button key={x.value} className="btn" onClick={() => c.resolve(x.value)}>
              {x.label}
            </button>
          ))}
          <button ref={confirmRef} className={`btn ${c.destructive ? 'danger solid' : 'primary'}`} onClick={() => c.resolve('confirm')}>
            {c.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
