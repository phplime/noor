import { useEffect, useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label="More information">
      <Icon name="info" size={13} />
      <span className="tip" role="tooltip">
        {children}
      </span>
    </span>
  );
}

export function Section({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section-title">
        {title}
        {aside && <span className="aside">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

export function Field({ label, hint, info, children }: { label?: ReactNode; hint?: ReactNode; info?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      {label && (
        <span className="field-label">
          {label}
          {info && <InfoTip>{info}</InfoTip>}
        </span>
      )}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

interface NumberFieldProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  integer?: boolean;
  label?: ReactNode;
  info?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}

/**
 * Numeric input that only reports valid values. While the text is invalid it is
 * marked red and the last valid value stays in effect.
 */
export function NumberField({ value, onChange, min = 0, max = 100000, step = 1, unit, integer = true, label, info, hint, disabled, title, ariaLabel }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const parse = (s: string): number | null => {
    if (s.trim() === '') return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (integer && !Number.isInteger(n)) return null;
    if (n < min || n > max) return null;
    return n;
  };
  const valid = parse(text) !== null;

  const input = (
    <div className="input-group">
      <input
        className={`input mono${valid ? '' : ' invalid'}`}
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        aria-invalid={!valid}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parse(e.target.value);
          if (n !== null) onChange(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? step * 10 : step);
            const n = Math.min(max, Math.max(min, (parse(text) ?? value) + delta));
            const rounded = integer ? Math.round(n) : Math.round(n * 100) / 100;
            setText(String(rounded));
            onChange(rounded);
          } else if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
  if (!label && !hint) return input;
  return (
    <Field label={label} info={info} hint={!valid ? `Enter a ${integer ? 'whole number' : 'number'} from ${min} to ${max}` : hint}>
      {input}
    </Field>
  );
}

export function Checkbox({ checked, onChange, label, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; title?: string }) {
  const id = useId();
  return (
    <label className="checkbox" htmlFor={id} title={title}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, label, info, hint, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: ReactNode; info?: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const el = (
    <select className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} aria-label={typeof label === 'string' ? label : undefined}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return label ? (
    <Field label={label} info={info} hint={hint}>
      {el}
    </Field>
  ) : (
    el
  );
}

export function Segmented<T extends string>({ value, onChange, options, vertical, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string; icon?: IconName }[]; vertical?: boolean; ariaLabel?: string }) {
  return (
    <div className={`segmented${vertical ? ' vertical' : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1, format, label, info, ariaLabel }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string; label?: ReactNode; info?: ReactNode; ariaLabel?: string }) {
  const el = (
    <div className="slider-row">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)} />
      <span className="value">{format ? format(value) : value}</span>
    </div>
  );
  return label ? (
    <Field label={label} info={info}>
      {el}
    </Field>
  ) : (
    el
  );
}

const SWATCHES = ['#ffffff', '#000000', '#f5f5f7', '#1d1d1f', '#2f6fe4'];

export function ColorField({ value, onChange, label, disabled, swatches = true }: { value: string; onChange: (v: string) => void; label?: ReactNode; disabled?: boolean; swatches?: boolean }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  const el = (
    <div className="color-field" style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} aria-label="Pick color" />
      <input
        className={`input mono${/^#[0-9a-f]{6}$/i.test(text) ? '' : ' invalid'}`}
        style={{ width: 84 }}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
        onBlur={() => setText(hex)}
        aria-label="Hex color"
      />
      {swatches && (
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button key={c} type="button" title={c} style={{ background: c }} onClick={() => onChange(c)} />
          ))}
        </div>
      )}
    </div>
  );
  return label ? <Field label={label}>{el}</Field> : el;
}

export function Callout({ kind = 'info', icon, children }: { kind?: 'info' | 'warning' | 'danger' | 'success' | 'neutral'; icon?: IconName; children: ReactNode }) {
  const defaultIcon: IconName = kind === 'success' ? 'check' : kind === 'info' || kind === 'neutral' ? 'info' : 'alert';
  return (
    <div className={`callout ${kind}`} role={kind === 'danger' || kind === 'warning' ? 'alert' : undefined}>
      <Icon name={icon ?? defaultIcon} size={15} />
      <div className="callout-body">{children}</div>
    </div>
  );
}
