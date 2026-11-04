import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop } from '../../components/FileQueue';
import { ExportPanel } from '../../components/ExportPanel';
import { PreviewStage, ZoomControls, useZoom } from '../../components/PreviewStage';
import { BatchProgress } from '../../components/BatchProgress';
import { Callout, Checkbox, NumberField, Section, Segmented } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { CropEditor } from './CropEditor';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useExportRunner } from '../../hooks/useExportRunner';
import { useUndoable } from '../../hooks/useUndoable';
import { useShortcut } from '../../hooks/useShortcut';
import { useOnSettingsLoaded, useToolExport } from '../../hooks/useToolExport';
import { cropOp, DEFAULT_RESIZE, resizeOp } from '../../services/image-processing';
import { applyRatio, clampRect, maxRectForRatio, parseRatio, toCropSpec, type Rect } from '../../utils/cropMath';
import type { Operation } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { formatDims, ratioLabel, stem } from '../../utils/format';
import { isIOS } from '../../utils/platform';

const TOOL_ID = 'crop';

const PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'free', label: 'Freeform', w: 0, h: 0 },
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '3:2', label: '3:2', w: 3, h: 2 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '2:3', label: '2:3', w: 2, h: 3 },
  { id: 'custom', label: 'Custom', w: 0, h: 0 },
];

interface RatioState {
  id: string;
  w: number;
  h: number;
}

export default function CropTool({ active }: ToolProps) {
  const { settings } = useApp();
  const queue = useImportQueue({ multiple: false });
  const file = queue.selectedFile;
  const [ratioState, setRatioState] = useState<RatioState>({ id: 'free', w: 590, h: 300 });
  const [exact, setExact] = useState({ on: false, w: 1200, h: 628 });
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const crop = useUndoable<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [exportOpts, setExportOpts] = useToolExport(TOOL_ID, '-cropped');
  const runner = useExportRunner(TOOL_ID);
  const bounds = file ? { w: file.width, h: file.height } : { w: 1, h: 1 };

  useOnSettingsLoaded(() => {
    const parsed = parseRatio(settings.defaultAspectRatio);
    if (parsed) {
      const preset = PRESETS.find((p) => p.w === parsed.w && p.h === parsed.h);
      setRatioState({ id: preset?.id ?? 'custom', w: parsed.w, h: parsed.h });
    }
  });

  // Effective ratio: exact output size wins, then preset/custom, then free.
  const ratio: number | null = exact.on
    ? exact.w / exact.h
    : ratioState.id === 'free'
      ? null
      : ratioState.id === 'custom'
        ? ratioState.w / ratioState.h
        : (PRESETS.find((p) => p.id === ratioState.id)!.w / PRESETS.find((p) => p.id === ratioState.id)!.h);

  // New image: start with the largest crop for the current ratio.
  useEffect(() => {
    if (file) crop.replace(maxRectForRatio({ w: file.width, h: file.height }, ratio), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  // Ratio changed: reshape the crop around its centre.
  useEffect(() => {
    if (file) crop.set(applyRatio(crop.value, ratio, bounds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio]);

  const spec = toCropSpec(crop.value, bounds);
  const operations: Operation[] = useMemo(() => {
    const ops: Operation[] = [cropOp(spec)];
    if (exact.on) ops.push(resizeOp({ ...DEFAULT_RESIZE, mode: 'stretch', width: exact.w, height: exact.h }));
    return ops;
  }, [spec.x, spec.y, spec.width, spec.height, exact.on, exact.w, exact.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const outW = exact.on ? exact.w : spec.width;
  const outH = exact.on ? exact.h : spec.height;

  const z = useZoom(bounds.w, bounds.h);
  const doExport = () => {
    if (!file || runner.running) return;
    void runner.run([{ path: file.path, relDir: null }], operations, exportOpts);
  };
  useShortcut('mod+enter', doExport, active);
  useShortcut('mod+z', crop.undo, active);
  useShortcut('escape', () => void runner.cancel(), active && runner.running);

  const setRect = (patch: Partial<Rect>) => crop.set(clampRect({ ...crop.value, ...patch }, bounds));
  const swapOrientation = () => {
    if (exact.on) setExact({ ...exact, w: exact.h, h: exact.w });
    else if (ratioState.id === 'custom') setRatioState({ ...ratioState, w: ratioState.h, h: ratioState.w });
    else {
      const p = PRESETS.find((x) => x.id === ratioState.id);
      if (p && p.w) {
        const flipped = PRESETS.find((x) => x.w === p.h && x.h === p.w);
        setRatioState(flipped ? { id: flipped.id, w: flipped.w, h: flipped.h } : { id: 'custom', w: p.h, h: p.w });
      }
    }
  };

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn" onClick={queue.addFiles} title="Open image (⌘O)">
          <Icon name="image" /> Open…
        </button>
        <button className="btn primary" disabled={!file || runner.running} onClick={doExport} title="Export (⌘↩)">
          Export Crop
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active} label="Drop an image to crop it" />
        {!file ? (
          <EmptyDrop queue={queue} multiple={false} title="Crop an image" description="Select the area to keep. Everything outside the selection is removed. Use presets like 16:9 or any custom ratio such as 590:300." />
        ) : view === 'preview' ? (
          <PreviewStage
            file={file}
            operations={operations}
            extraBar={
              <Segmented<'edit' | 'preview'> value={view} onChange={setView} options={[{ value: 'edit', label: 'Edit crop' }, { value: 'preview', label: 'Preview result' }]} />
            }
          />
        ) : (
          <div className="stage">
            <div className="stage-bar">
              <Segmented<'edit' | 'preview'> value={view} onChange={setView} options={[{ value: 'edit', label: 'Edit crop' }, { value: 'preview', label: 'Preview result' }]} />
              <span className="small muted stage-hint">{isIOS() ? 'Drag the box or its corners' : 'Drag the box or its handles · arrow keys nudge'}</span>
              <span className="spacer" />
              <ZoomControls z={z} />
            </div>
            <div className="stage-viewport" ref={z.viewport}>
              <CropEditor file={file} rect={crop.value} ratio={ratio} scale={z.scale} onChange={crop.set} />
            </div>
            <div className="stage-status">
              Crop <strong className="mono">{formatDims(spec.width, spec.height)}</strong> → export <strong className="mono">{formatDims(outW, outH)}</strong>
            </div>
          </div>
        )}
      </div>

      <aside className="inspector" aria-label="Crop settings">
        <Section title="Aspect ratio" aside={<button className="btn ghost small" onClick={swapOrientation} title="Switch portrait / landscape"><Icon name="swap" size={13} /> Rotate</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }} role="radiogroup" aria-label="Aspect ratio">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={ratioState.id === p.id && !exact.on}
                className={`btn${ratioState.id === p.id && !exact.on ? ' primary' : ''}`}
                disabled={exact.on}
                onClick={() => setRatioState(p.id === 'custom' ? { id: 'custom', w: ratioState.w, h: ratioState.h } : { id: p.id, w: p.w, h: p.h })}
              >
                {p.label}
              </button>
            ))}
          </div>
          {ratioState.id === 'custom' && !exact.on && (
            <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
              <NumberField label="Ratio width" value={ratioState.w} min={0.01} max={100000} integer={false} onChange={(w) => setRatioState({ ...ratioState, w })} />
              <span className="none" style={{ paddingBottom: 6 }}>:</span>
              <NumberField label="Ratio height" value={ratioState.h} min={0.01} max={100000} integer={false} onChange={(h) => setRatioState({ ...ratioState, h })} />
            </div>
          )}
          <p className="field-hint" style={{ marginTop: 8 }}>
            {exact.on ? `Locked to the exact output size (${ratioLabel(exact.w, exact.h)}).` : ratio === null ? 'Freeform: drag any edge freely.' : `Crop box is locked to ${ratioState.id === 'custom' ? `${ratioState.w}:${ratioState.h}` : ratioState.id}.`}
          </p>
        </Section>

        {file && (
          <Section title="Crop area (pixels)" aside={<button className="btn ghost small" onClick={() => crop.set(maxRectForRatio(bounds, ratio))}>Maximize</button>}>
            <div className="row">
              <NumberField label="X" value={spec.x} min={0} max={file.width - 1} onChange={(x) => setRect({ x })} />
              <NumberField label="Y" value={spec.y} min={0} max={file.height - 1} onChange={(y) => setRect({ y })} />
            </div>
            <div className="row">
              <NumberField label="Width" value={spec.width} min={1} max={file.width} onChange={(w) => crop.set(applyRatio({ ...crop.value, w, h: ratio ? w / ratio : crop.value.h }, ratio, bounds))} />
              <NumberField label="Height" value={spec.height} min={1} max={file.height} onChange={(h) => crop.set(applyRatio({ ...crop.value, h, w: ratio ? h * ratio : crop.value.w }, ratio, bounds))} />
            </div>
          </Section>
        )}

        <Section title="Output size">
          <Checkbox checked={exact.on} onChange={(on) => setExact({ ...exact, on })} label="Export at an exact size" title="The crop box locks to this ratio and the result is resized to exactly these dimensions." />
          {exact.on && (
            <div className="row" style={{ marginTop: 10 }}>
              <NumberField label="Width" unit="px" value={exact.w} min={1} max={settings.limits.maxDimension} onChange={(w) => setExact({ ...exact, w })} />
              <NumberField label="Height" unit="px" value={exact.h} min={1} max={settings.limits.maxDimension} onChange={(h) => setExact({ ...exact, h })} />
            </div>
          )}
          {file && (
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Original</dt>
              <dd className="mono">{formatDims(file.width, file.height)}</dd>
              <dt>Crop selection</dt>
              <dd className="mono">{formatDims(spec.width, spec.height)}</dd>
              <dt>Exported image</dt>
              <dd className="mono">
                <strong>{formatDims(outW, outH)}</strong>
              </dd>
            </dl>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <Callout kind="neutral">Crop removes everything outside the selection. To change the size without losing any part of the image, use Resize &amp; Canvas.</Callout>
          </div>
        </Section>

        <ExportPanel
          value={exportOpts}
          onChange={setExportOpts}
          sourceFormats={file ? [file.format] : []}
          sample={file ? { stem: stem(file.name), w: outW, h: outH, format: file.format } : undefined}
          showPreserveStructure={false}
        />

        <div className="inspector-footer">
          <BatchProgress state={runner} onCancel={runner.cancel} onDismiss={runner.reset} />
          <div className="btn-row">
            <button className="btn" onClick={crop.undo} disabled={!crop.canUndo} title="Undo (⌘Z)">
              <Icon name="undo" /> Undo
            </button>
            <button className="btn" disabled={!file} onClick={() => file && crop.reset(maxRectForRatio(bounds, ratio))} title="Reset crop">
              <Icon name="reset" /> Reset
            </button>
            <button className="btn primary" style={{ flex: 1 }} disabled={!file || runner.running} onClick={doExport}>
              Export {formatDims(outW, outH)}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
