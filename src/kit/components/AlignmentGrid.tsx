import type { Anchor, Placement } from '../types/engine';
import { Checkbox, NumberField } from './Field';

const GRID: { anchor: Anchor; label: string }[] = [
  { anchor: 'topLeft', label: 'Top left' },
  { anchor: 'topCenter', label: 'Top center' },
  { anchor: 'topRight', label: 'Top right' },
  { anchor: 'centerLeft', label: 'Center left' },
  { anchor: 'center', label: 'Center' },
  { anchor: 'centerRight', label: 'Center right' },
  { anchor: 'bottomLeft', label: 'Bottom left' },
  { anchor: 'bottomCenter', label: 'Bottom center' },
  { anchor: 'bottomRight', label: 'Bottom right' },
];

export const ANCHOR_LABEL: Record<Anchor, string> = {
  ...(Object.fromEntries(GRID.map((g) => [g.anchor, g.label])) as Record<Exclude<Anchor, 'custom'>, string>),
  custom: 'Custom position',
};

/** Fractions for a preset anchor, used to seed custom X/Y. */
export function anchorFractions(a: Anchor): [number, number] {
  const col = a.endsWith('Left') ? 0 : a.endsWith('Right') ? 1 : 0.5;
  const row = a.startsWith('top') ? 0 : a.startsWith('bottom') ? 1 : 0.5;
  return a === 'custom' ? [0.5, 0.5] : [col, row];
}

/**
 * 3×3 alignment picker plus optional custom X/Y (as % of the free space, so the
 * element always stays fully inside its container).
 */
export function AlignmentGrid({ value, onChange, allowCustom = true }: { value: Placement; onChange: (p: Placement) => void; allowCustom?: boolean }) {
  const custom = value.anchor === 'custom';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div className="align-grid" role="radiogroup" aria-label="Alignment">
        {GRID.map((g) => (
          <button
            key={g.anchor}
            type="button"
            role="radio"
            aria-checked={value.anchor === g.anchor}
            aria-label={g.label}
            title={g.label}
            className={value.anchor === g.anchor ? 'active' : ''}
            onClick={() => onChange({ ...value, anchor: g.anchor })}
          />
        ))}
      </div>
      {allowCustom && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <Checkbox
            checked={custom}
            label="Custom X / Y"
            title="Position as a percentage of the free space (0% = left/top edge, 100% = right/bottom edge)"
            onChange={(on) => {
              if (on) {
                const [x, y] = anchorFractions(value.anchor);
                onChange({ anchor: 'custom', x, y });
              } else {
                onChange({ ...value, anchor: 'center' });
              }
            }}
          />
          {custom && (
            <div className="row" style={{ marginTop: 8 }}>
              <NumberField label="X" unit="%" value={Math.round(value.x * 100)} min={0} max={100} onChange={(v) => onChange({ ...value, x: v / 100 })} />
              <NumberField label="Y" unit="%" value={Math.round(value.y * 100)} min={0} max={100} onChange={(v) => onChange({ ...value, y: v / 100 })} />
            </div>
          )}
          {!custom && <div className="field-hint" style={{ marginTop: 6 }}>{ANCHOR_LABEL[value.anchor]}</div>}
        </div>
      )}
    </div>
  );
}
