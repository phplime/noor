import type { ReactNode } from 'react';

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  );
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row__text">
        <div className="row__label">{label}</div>
        {hint && <div className="row__hint">{hint}</div>}
      </div>
      <div className="row__control">{children}</div>
    </div>
  );
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function SaveStatus({ status, error }: { status: 'idle' | 'saving' | 'saved' | 'error'; error?: string | null }) {
  if (status === 'idle') return null;
  return (
    <span className={`save-status save-status--${status}`}>
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : error ?? 'Could not save'}
    </span>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return <div className={`notice notice--${kind}`}>{children}</div>;
}

/** Integer input that never emits NaN. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  width = 72,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
  suffix?: string;
}) {
  return (
    <span className="num">
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        style={{ width }}
        onChange={(e) => {
          let v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          onChange(v);
        }}
      />
      {suffix && <span className="num__suffix">{suffix}</span>}
    </span>
  );
}
