import { useState } from 'react';
import { AlignmentGrid } from './AlignmentGrid';
import { Callout, Checkbox, ColorField, Field, InfoTip, NumberField, Section, Segmented, Select } from './Field';
import { Icon } from './Icon';
import { RESIZE_MODE_INFO } from '../services/image-processing';
import type { Filter, ResizeMode, ResizeSpec } from '../types/engine';
import { ratioLabel } from '../utils/format';

export const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '590 × 300 (email banner)', w: 590, h: 300 },
  { label: '1200 × 628 (social link)', w: 1200, h: 628 },
  { label: '1920 × 1080 (Full HD)', w: 1920, h: 1080 },
  { label: '1280 × 720 (HD)', w: 1280, h: 720 },
  { label: '1080 × 1080 (square post)', w: 1080, h: 1080 },
  { label: '1080 × 1350 (portrait post)', w: 1080, h: 1350 },
  { label: '1080 × 1920 (story)', w: 1080, h: 1920 },
  { label: '1024 × 1024', w: 1024, h: 1024 },
  { label: '512 × 512', w: 512, h: 512 },
  { label: '80 × 80 (thumbnail)', w: 80, h: 80 },
];

const PERCENTS = [25, 50, 75, 100, 150, 200];
export const MAX_SIDE = 30000;

interface ResizeControlsProps {
  value: ResizeSpec;
  onChange: (v: ResizeSpec) => void;
  /** Source size used for the aspect-ratio lock (representative image in batches). */
  source?: { w: number; h: number };
  modes?: ResizeMode[];
  maxDimension?: number;
}

export function ResizeControls({ value, onChange, source, modes = ['fit', 'canvas', 'stretch', 'percent'], maxDimension = MAX_SIDE }: ResizeControlsProps) {
  const [locked, setLocked] = useState(false);
  const set = (patch: Partial<ResizeSpec>) => onChange({ ...value, ...patch });
  const info = RESIZE_MODE_INFO[value.mode];
  const ratio = source ? source.w / source.h : value.width / value.height;

  const setW = (w: number) => (locked ? set({ width: w, height: Math.max(1, Math.round(w / ratio)) }) : set({ width: w }));
  const setH = (h: number) => (locked ? set({ height: h, width: Math.max(1, Math.round(h * ratio)) }) : set({ height: h }));
  const usesSize = value.mode !== 'percent';
  const usesPlacement = value.mode === 'fit' || value.mode === 'canvas';

  return (
    <>
      <Section title="Mode">
        <div className="segmented vertical" role="radiogroup" aria-label="Resize mode">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={value.mode === m}
              className={value.mode === m ? 'active' : ''}
              style={{ textAlign: 'left', padding: '6px 10px' }}
              onClick={() => set({ mode: m })}
            >
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{RESIZE_MODE_INFO[m].label}</div>
              <div className="small subtle">{RESIZE_MODE_INFO[m].short}</div>
            </button>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {info.help}
        </p>
      </Section>

      {usesSize ? (
        <Section
          title="Output size"
          aside={
            <span className="small subtle mono" title="Simplified aspect ratio of the output">
              {ratioLabel(value.width, value.height)}
            </span>
          }
        >
          <Select<string>
            value=""
            onChange={(v) => {
              if (v === 'original' && source) return set({ width: source.w, height: source.h });
              const p = SIZE_PRESETS[Number(v)];
              if (p) set({ width: p.w, height: p.h });
            }}
            options={[
              { value: '', label: 'Presets…' },
              ...(source ? [{ value: 'original', label: `Original (${source.w} × ${source.h})` }] : []),
              ...SIZE_PRESETS.map((p, i) => ({ value: String(i), label: p.label })),
            ]}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <NumberField label="Width" unit="px" value={value.width} min={1} max={maxDimension} onChange={setW} />
            <button
              type="button"
              className={`btn icon none${locked ? ' primary' : ''}`}
              title={locked ? 'Aspect ratio locked to the image (click to unlock)' : 'Lock aspect ratio to the image'}
              aria-pressed={locked}
              onClick={() => {
                const next = !locked;
                setLocked(next);
                if (next) set({ height: Math.max(1, Math.round(value.width / ratio)) });
              }}
            >
              <Icon name={locked ? 'lock' : 'unlock'} />
            </button>
            <NumberField label="Height" unit="px" value={value.height} min={1} max={maxDimension} onChange={setH} />
            <button type="button" className="btn icon none" title="Swap width and height" onClick={() => set({ width: value.height, height: value.width })}>
              <Icon name="swap" />
            </button>
          </div>
          {value.mode === 'canvas' && (
            <div className="field">
              <Checkbox
                checked={value.scaleImage}
                onChange={(v) => set({ scaleImage: v })}
                label="Scale image down if it doesn't fit"
                title="Off: the image keeps its exact pixel size. On: images larger than the canvas are scaled down proportionally (never enlarged)."
              />
              <span className="field-hint">{value.scaleImage ? 'Larger images shrink to fit; smaller ones keep their size.' : 'Image keeps its original pixel size. Nothing is ever cropped.'}</span>
            </div>
          )}
          {(value.mode === 'fit' || value.mode === 'within') && (
            <div className="field">
              <Checkbox checked={value.allowUpscale} onChange={(v) => set({ allowUpscale: v })} label="Enlarge images smaller than the target" />
            </div>
          )}
          {value.mode === 'stretch' && source && Math.abs(source.w / source.h - value.width / value.height) > 0.01 && (
            <div className="field">
              <Callout kind="warning">
                Stretch changes the proportions from {ratioLabel(source.w, source.h)} to {ratioLabel(value.width, value.height)} — the image will look distorted. Use Fit / Contain to keep proportions without cropping.
              </Callout>
            </div>
          )}
        </Section>
      ) : (
        <Section title="Scale">
          <Segmented<string> value={PERCENTS.includes(value.percent) ? String(value.percent) : 'custom'} onChange={(v) => v !== 'custom' && set({ percent: Number(v) })} options={[...PERCENTS.map((p) => ({ value: String(p), label: `${p}%` }))]} />
          <div className="row" style={{ marginTop: 10 }}>
            <NumberField label="Custom" unit="%" value={value.percent} min={0.1} max={1000} integer={false} step={1} onChange={(v) => set({ percent: v })} />
            {source && (
              <Field label="Result">
                <div className="mono" style={{ height: 28, display: 'flex', alignItems: 'center' }}>
                  {Math.max(1, Math.round((source.w * value.percent) / 100))} × {Math.max(1, Math.round((source.h * value.percent) / 100))}
                </div>
              </Field>
            )}
          </div>
        </Section>
      )}

      {usesPlacement && (
        <Section title="Image position">
          <AlignmentGrid value={value.placement} onChange={(placement) => set({ placement })} />
        </Section>
      )}

      {usesPlacement && (
        <Section title="Background (padding)">
          <div className="field">
            <Checkbox
              checked={value.background.transparent}
              onChange={(transparent) => set({ background: { ...value.background, transparent } })}
              label="Transparent"
              title="Kept in PNG, WebP and TIFF. JPEG/BMP use the export fill color instead."
            />
          </div>
          <div className="field">
            <ColorField value={value.background.color} disabled={value.background.transparent} onChange={(color) => set({ background: { ...value.background, color } })} />
          </div>
        </Section>
      )}

      <Section
        title={
          <>
            Resampling <InfoTip>Lanczos gives the sharpest results for photos. Nearest neighbour keeps hard pixel edges (pixel art, icons).</InfoTip>
          </>
        }
      >
        <Select<Filter>
          value={value.filter}
          onChange={(filter) => set({ filter })}
          options={[
            { value: 'lanczos3', label: 'High quality (Lanczos)' },
            { value: 'catmullRom', label: 'Bicubic (Catmull-Rom)' },
            { value: 'bilinear', label: 'Bilinear' },
            { value: 'nearest', label: 'Nearest neighbour (pixel art)' },
          ]}
        />
      </Section>
    </>
  );
}
