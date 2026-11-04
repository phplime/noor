import { useMemo, useState } from 'react';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop, FileQueue } from '../../components/FileQueue';
import { ExportPanel } from '../../components/ExportPanel';
import { PreviewStage } from '../../components/PreviewStage';
import { BatchProgress } from '../../components/BatchProgress';
import { CurveEditor } from '../../components/CurveEditor';
import { Checkbox, Section, Segmented } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useExportRunner } from '../../hooks/useExportRunner';
import { useUndoable } from '../../hooks/useUndoable';
import { useShortcut } from '../../hooks/useShortcut';
import { useToolExport } from '../../hooks/useToolExport';
import type { AdjustSpec, Curves, Operation, TransformSpec } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { CURVE_PRESETS, LINEAR, isIdentityCurve } from '../../utils/curve';
import { formatDims, stem } from '../../utils/format';
import { ADJUST_PRESETS, DEFAULT_ADJUST, isNeutral } from './presets';
import { isMobile } from '../../utils/platform';

const TOOL_ID = 'adjust';

interface State {
  transform: TransformSpec;
  adjust: AdjustSpec;
}

const INITIAL: State = { transform: { rotate: 0, flipH: false, flipV: false }, adjust: DEFAULT_ADJUST };

type Channel = keyof Curves;
const CHANNELS: { value: Channel; label: string; color: string }[] = [
  { value: 'rgb', label: 'RGB', color: 'var(--text)' },
  { value: 'red', label: 'Red', color: '#e5484d' },
  { value: 'green', label: 'Green', color: '#30a46c' },
  { value: 'blue', label: 'Blue', color: '#3e63dd' },
];

function AdjSlider({ label, value, onChange, min = -100, max = 100, title }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; title?: string }) {
  return (
    <div className={`adj-slider${value !== 0 ? ' changed' : ''}`} title={title}>
      <label onDoubleClick={() => onChange(0)}>{label}</label>
      <span className="val" onDoubleClick={() => onChange(0)}>
        {value > 0 && min < 0 ? `+${value}` : value}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
      />
    </div>
  );
}

export default function AdjustTool({ active }: ToolProps) {
  const queue = useImportQueue();
  const file = queue.selectedFile;
  const st = useUndoable<State>(INITIAL);
  const [channel, setChannel] = useState<Channel>('rgb');
  const [preset, setPreset] = useState<string>('original');
  const [exportOpts, setExportOpts] = useToolExport(TOOL_ID, '-enhanced');
  const runner = useExportRunner(TOOL_ID);
  const { transform: t, adjust: a } = st.value;

  const setA = (patch: Partial<AdjustSpec>) => st.set({ ...st.value, adjust: { ...a, ...patch } });
  const setT = (patch: Partial<TransformSpec>) => st.set({ ...st.value, transform: { ...t, ...patch } });
  const setCurve = (points: Curves[Channel]) => setA({ curves: { ...a.curves, [channel]: points } });

  const operations: Operation[] = useMemo(() => {
    const ops: Operation[] = [];
    if (t.rotate || t.flipH || t.flipV) ops.push({ type: 'transform', ...t });
    if (!isNeutral(a)) ops.push({ type: 'adjust', ...a });
    return ops;
  }, [t, a]);

  const outDims = file ? (t.rotate === 90 || t.rotate === 270 ? { w: file.height, h: file.width } : { w: file.width, h: file.height }) : null;
  const count = queue.files.length;

  const doExport = () => {
    if (!count || runner.running) return;
    void runner.run(queue.files.map((f) => ({ path: f.path, relDir: f.relDir })), operations, exportOpts);
  };
  useShortcut('mod+enter', doExport, active);
  useShortcut('mod+z', st.undo, active);
  useShortcut('escape', () => void runner.cancel(), active && runner.running);

  const rotate = (delta: 90 | -90) => setT({ rotate: (((t.rotate + delta) % 360) + 360) % 360 as TransformSpec['rotate'] });
  const curvePoints = a.curves[channel].length >= 2 ? a.curves[channel] : LINEAR;
  const channelColor = CHANNELS.find((c) => c.value === channel)!.color;

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn" onClick={queue.addFiles} title="Add images (⌘O)">
          <Icon name="plus" /> Images
        </button>
        <button className="btn" onClick={queue.addFolder} title={isMobile() ? 'Add images from the Files app' : 'Add folder (⇧⌘O)'}>
          <Icon name="folder" /> {isMobile() ? 'Files' : 'Folder'}
        </button>
        <button className="btn primary" disabled={!count || runner.running} onClick={doExport} title="Export (⌘↩)">
          Export {count > 1 ? `${count} Images` : ''}
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active} />
        {!count ? (
          <EmptyDrop
            queue={queue}
            title="Adjust & enhance photos"
            description="Rotate to portrait or landscape, fix brightness and contrast, shape the tone curve, warm up colors and sharpen. Apply the same look to one photo or a whole folder."
          />
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              {file && (
                <PreviewStage
                  file={file}
                  operations={operations}
                  extraBar={<span className="small muted">Double-click a slider to reset it</span>}
                />
              )}
            </div>
            {count > 1 && (
              <div style={{ height: 200, flex: 'none' }}>
                <FileQueue queue={queue} statuses={runner.statuses} busy={runner.running} />
              </div>
            )}
          </>
        )}
      </div>

      <aside className="inspector" aria-label="Adjustments">
        <Section title="Looks">
          <div className="chips" role="radiogroup" aria-label="Presets">
            {ADJUST_PRESETS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={preset === p.id}
                className={`chip${preset === p.id ? ' active' : ''}`}
                title={p.description}
                onClick={() => {
                  setPreset(p.id);
                  st.set({ ...st.value, adjust: { ...DEFAULT_ADJUST, ...p.spec, curves: { ...DEFAULT_ADJUST.curves, ...(p.spec.curves ?? {}) } } });
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <Checkbox
              checked={a.autoEnhance}
              onChange={(autoEnhance) => setA({ autoEnhance })}
              label={
                <span>
                  <Icon name="wand" size={13} style={{ verticalAlign: -2 }} /> Auto levels (per image)
                </span>
              }
              title="Analyses each photo and stretches its tonal range from darkest to brightest, without changing colors."
            />
          </div>
        </Section>

        <Section title="Orientation" aside={outDims && <span className="small subtle mono">{formatDims(outDims.w, outDims.h)} · {outDims.h > outDims.w ? 'portrait' : outDims.h < outDims.w ? 'landscape' : 'square'}</span>}>
          <div className="btn-row">
            <button className="btn" onClick={() => rotate(-90)} title="Rotate 90° left">
              <Icon name="rotateLeft" /> Left
            </button>
            <button className="btn" onClick={() => rotate(90)} title="Rotate 90° right">
              <Icon name="rotateRight" /> Right
            </button>
            <button className={`btn icon${t.flipH ? ' primary' : ''}`} aria-pressed={t.flipH} onClick={() => setT({ flipH: !t.flipH })} title="Flip horizontally (mirror)">
              <Icon name="flipH" />
            </button>
            <button className={`btn icon${t.flipV ? ' primary' : ''}`} aria-pressed={t.flipV} onClick={() => setT({ flipV: !t.flipV })} title="Flip vertically">
              <Icon name="flipV" />
            </button>
          </div>
        </Section>

        <Section title="Light">
          <AdjSlider label="Exposure" value={a.exposure} onChange={(exposure) => setA({ exposure })} title="Overall light, like changing the camera exposure (±1.5 stops)" />
          <AdjSlider label="Brightness" value={a.brightness} onChange={(brightness) => setA({ brightness })} title="Brightens or darkens mid-tones; pure black and white stay put" />
          <AdjSlider label="Contrast" value={a.contrast} onChange={(contrast) => setA({ contrast })} />
          <AdjSlider label="Highlights" value={a.highlights} onChange={(highlights) => setA({ highlights })} title="Negative recovers detail in bright areas such as skies" />
          <AdjSlider label="Shadows" value={a.shadows} onChange={(shadows) => setA({ shadows })} title="Positive opens up detail in dark areas" />
        </Section>

        <Section
          title="Tone curve"
          aside={
            <button className="btn ghost small" onClick={() => setCurve(LINEAR)} disabled={isIdentityCurve(a.curves[channel])}>
              Reset
            </button>
          }
        >
          <Segmented<Channel> value={channel} onChange={setChannel} options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))} ariaLabel="Curve channel" />
          <div style={{ marginTop: 10 }}>
            <CurveEditor points={curvePoints} onChange={setCurve} color={channelColor} />
          </div>
          <p className="field-hint" style={{ marginTop: 6 }}>
            Click to add a point, drag to shape, double-click a point to remove it. Left side = shadows, right = highlights.
          </p>
          <div className="chips" style={{ marginTop: 8 }}>
            {CURVE_PRESETS.map((c) => (
              <button key={c.id} className="chip" onClick={() => setCurve(c.points)}>
                {c.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Color">
          <AdjSlider label="Temperature" value={a.temperature} onChange={(temperature) => setA({ temperature })} title="Negative = cooler / bluer, positive = warmer / yellower" />
          <AdjSlider label="Tint" value={a.tint} onChange={(tint) => setA({ tint })} title="Negative = greener, positive = more magenta" />
          <AdjSlider label="Saturation" value={a.saturation} onChange={(saturation) => setA({ saturation })} title="-100 makes the photo black & white" />
          <AdjSlider label="Vibrance" value={a.vibrance} onChange={(vibrance) => setA({ vibrance })} title="Boosts muted colors more than already-strong ones; gentle on skin tones" />
        </Section>

        <Section title="Detail & effects">
          <AdjSlider label="Sharpness" value={a.sharpness} min={0} onChange={(sharpness) => setA({ sharpness })} />
          <AdjSlider label="Vignette" value={a.vignette} min={0} onChange={(vignette) => setA({ vignette })} title="Darkens the corners to draw attention to the centre" />
        </Section>

        <ExportPanel
          value={exportOpts}
          onChange={setExportOpts}
          sourceFormats={[...new Set(queue.files.map((f) => f.format))]}
          sample={file && outDims ? { stem: stem(file.name), w: outDims.w, h: outDims.h, format: file.format } : undefined}
        />

        <div className="inspector-footer">
          <BatchProgress state={runner} onCancel={runner.cancel} onDismiss={runner.reset} />
          <div className="btn-row">
            <button className="btn" onClick={st.undo} disabled={!st.canUndo} title="Undo (⌘Z)">
              <Icon name="undo" /> Undo
            </button>
            <button
              className="btn"
              onClick={() => {
                st.reset(INITIAL);
                setPreset('original');
              }}
              title="Remove all adjustments"
            >
              <Icon name="reset" /> Reset
            </button>
            <button className="btn primary" style={{ flex: 1 }} disabled={!count || runner.running} onClick={doExport}>
              {count > 1 ? `Export ${count} Images` : 'Export'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
