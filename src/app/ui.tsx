import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NIcon, type NoorIconName } from './icons';

/** A tab page: large iOS-style title that scrolls with the content. */
export function Screen({
  title,
  eyebrow,
  right,
  top,
  children,
  className = '',
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  top?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`n-screen ${className}`}>
      {top}
      <header className="n-head">
        <div className="n-head__text">
          {eyebrow && <div className="n-eyebrow">{eyebrow}</div>}
          <h1 className="n-title">{title}</h1>
        </div>
        {right && <div className="n-head__right">{right}</div>}
      </header>
      {children}
    </div>
  );
}

/** A pushed page with a back button (sub-settings, embedded tools). */
export function Page({ title, onBack, right, children }: { title: ReactNode; onBack: () => void; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="n-page">
      <header className="n-page__bar">
        <button className="n-back" onClick={onBack} aria-label="Back">
          <NIcon name="chevronLeft" size={22} stroke={2.2} />
          <span>Back</span>
        </button>
        <div className="n-page__title">{title}</div>
        <div className="n-page__right">{right}</div>
      </header>
      <div className="n-page__body">{children}</div>
    </div>
  );
}

export function Card({ children, className = '', onClick, glow }: { children: ReactNode; className?: string; onClick?: () => void; glow?: string }) {
  // A div with role=button (not <button>) so cards can contain their own buttons.
  return (
    <div
      className={`n-card ${onClick ? 'n-card--tap' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={glow ? ({ ['--glow' as string]: glow } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="n-section">
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Circular progress ring (0–1). */
export function Ring({
  value,
  size = 120,
  stroke = 10,
  color = 'var(--n-accent)',
  track = 'rgba(255,255,255,0.08)',
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value || 0));
  return (
    <div className="n-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="n-ring__inner">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="n-seg" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={`n-seg__item ${o.id === value ? 'is-on' : ''}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`n-switch ${checked ? 'is-on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}

export function ListRow({
  icon,
  title,
  detail,
  right,
  onClick,
  chevron = !!onClick,
  meter,
}: {
  icon?: NoorIconName;
  title: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  /** 0–1 progress bar under the text. */
  meter?: number;
}) {
  // A div (not <button>) so rows can hold their own buttons and switches.
  return (
    <div
      className={`n-row ${icon ? 'n-row--icon' : ''} ${onClick ? 'n-row--tap' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {icon && (
        <span className="n-row__icon">
          <NIcon name={icon} size={17} stroke={2} />
        </span>
      )}
      <span className="n-row__text">
        <span className="n-row__title">{title}</span>
        {detail && <span className="n-row__detail">{detail}</span>}
        {meter !== undefined && (
          <span className="n-meter">
            <i style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }} />
          </span>
        )}
      </span>
      {right && <span className="n-row__right">{right}</span>}
      {chevron && <NIcon name="chevronRight" size={18} className="n-row__chev" />}
    </div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className="n-list">{children}</div>;
}

/** Bottom sheet (modal). */
export function Sheet({
  open,
  onClose,
  title,
  children,
  actions,
  closeLabel = 'Cancel',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  closeLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="n-sheet-wrap" onClick={onClose}>
      <div className="n-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="n-sheet__grab" />
        {(title || actions) && (
          <div className="n-sheet__head">
            <button className="n-link" onClick={onClose}>
              {closeLabel}
            </button>
            <div className="n-sheet__title">{title}</div>
            <div className="n-sheet__actions">{actions}</div>
          </div>
        )}
        <div className="n-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Empty({ icon, title, children }: { icon: NoorIconName; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="n-empty">
      <span className="n-empty__icon">
        <NIcon name={icon} size={28} />
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Pill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'gold' | 'green' | 'red' | 'blue' }) {
  return <span className={`n-pill n-pill--${tone}`}>{children}</span>;
}
