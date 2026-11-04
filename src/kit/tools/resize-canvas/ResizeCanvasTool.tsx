import { useMemo } from 'react';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop } from '../../components/FileQueue';
import { ExportPanel } from '../../components/ExportPanel';
import { LayoutLegend, PreviewStage } from '../../components/PreviewStage';
import { ResizeControls } from '../../components/ResizeControls';
import { DoesNotFit } from '../../components/DoesNotFit';
import { BatchProgress } from '../../components/BatchProgress';
import { Section } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useExportRunner } from '../../hooks/useExportRunner';
import { useUndoable } from '../../hooks/useUndoable';
import { usePlan } from '../../hooks/usePlan';
import { useShortcut } from '../../hooks/useShortcut';
import { DEFAULT_RESIZE, resizeOp } from '../../services/image-processing';
import { useOnSettingsLoaded, useToolExport } from '../../hooks/useToolExport';
import type { ResizeSpec } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { formatBytes, formatDims, stem } from '../../utils/format';

const TOOL_ID = 'resize-canvas';

export default function ResizeCanvasTool({ active }: ToolProps) {
  const { settings } = useApp();
  const queue = useImportQueue({ multiple: false });
  const file = queue.selectedFile;
  const initialSpec: ResizeSpec = { ...DEFAULT_RESIZE, mode: settings.defaultResizeMode, background: { color: settings.defaultBackground, transparent: false } };
  const spec = useUndoable<ResizeSpec>(initialSpec);
  const [exportOpts, setExportOpts] = useToolExport(TOOL_ID, '-{w}x{h}');
  const runner = useExportRunner(TOOL_ID);
  useOnSettingsLoaded(() =>
    spec.replace({ ...DEFAULT_RESIZE, mode: settings.defaultResizeMode, background: { color: settings.defaultBackground, transparent: false } }, true),
  );

  const operations = useMemo(() => [resizeOp(spec.value)], [spec.value]);
  const { plan, error: planError } = usePlan(file?.width, file?.height, operations);

  const doExport = () => {
    if (!file || runner.running) return;
    void runner.run([{ path: file.path, relDir: null }], operations, exportOpts);
  };
  useShortcut('mod+enter', doExport, active);
  useShortcut('mod+z', spec.undo, active);
  useShortcut('escape', () => void runner.cancel(), active && runner.running);

  const fixScale = () => spec.set({ ...spec.value, scaleImage: true });
  const fixEnlarge = (w: number, h: number) => spec.set({ ...spec.value, width: w, height: h });

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn" onClick={queue.addFiles} title="Open image (⌘O)">
          <Icon name="image" /> Open…
        </button>
        <button className="btn primary" disabled={!file || runner.running || !!planError} onClick={doExport} title="Export (⌘↩)">
          Export
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active} label="Drop an image to open it" />
        {!file ? (
          <EmptyDrop
            queue={queue}
            multiple={false}
            title="Resize without cropping"
            description="Export any image at exact pixel dimensions — the whole image always stays visible. Choose Fit, Canvas padding, Stretch or a percentage."
          />
        ) : (
          <PreviewStage
            file={file}
            operations={operations}
            showLayout
            renderError={(e) => <DoesNotFit error={e} onScale={fixScale} onEnlarge={fixEnlarge} />}
          />
        )}
      </div>

      <aside className="inspector" aria-label="Resize settings">
        {file && (
          <Section title="Image" aside={<button className="btn ghost small" onClick={queue.addFiles}>Change…</button>}>
            <div className="file-name truncate" title={file.path}>
              {file.name}
            </div>
            <div className="file-meta">
              <span>Original {formatDims(file.width, file.height)} px</span>
              <span>{formatBytes(file.size)}</span>
            </div>
          </Section>
        )}

        <ResizeControls value={spec.value} onChange={spec.set} source={file ? { w: file.width, h: file.height } : undefined} maxDimension={settings.limits.maxDimension} />

        {file && (
          <Section title="Result">
            {plan ? (
              <dl className="kv">
                <dt>Original</dt>
                <dd className="mono">{formatDims(plan.sourceW, plan.sourceH)}</dd>
                <dt>Output canvas</dt>
                <dd className="mono">
                  <strong>{formatDims(plan.outputW, plan.outputH)}</strong>
                </dd>
                {plan.resize && (
                  <>
                    <dt>Image area</dt>
                    <dd className="mono">
                      {formatDims(plan.resize.imageW, plan.resize.imageH)} at {plan.resize.imageX}, {plan.resize.imageY}
                    </dd>
                    <dt>Padding</dt>
                    <dd>{plan.resize.hasPadding ? (spec.value.background.transparent ? 'Transparent' : spec.value.background.color) : 'None'}</dd>
                    <dt>Cropping</dt>
                    <dd>None — the whole image is kept</dd>
                  </>
                )}
              </dl>
            ) : planError ? (
              <DoesNotFit error={planError} onScale={fixScale} onEnlarge={fixEnlarge} />
            ) : null}
            {plan?.resize?.hasPadding && (
              <div style={{ marginTop: 10 }}>
                <LayoutLegend />
              </div>
            )}
            {plan?.warnings.map((w) => (
              <p key={w} className="small" style={{ color: 'var(--warning)', marginTop: 8 }}>
                {w}
              </p>
            ))}
          </Section>
        )}

        <ExportPanel
          value={exportOpts}
          onChange={setExportOpts}
          sourceFormats={file ? [file.format] : []}
          introducesAlpha={spec.value.background.transparent && (spec.value.mode === 'fit' || spec.value.mode === 'canvas')}
          sample={file && plan ? { stem: stem(file.name), w: plan.outputW, h: plan.outputH, format: file.format } : undefined}
          showPreserveStructure={false}
        />

        <div className="inspector-footer">
          <BatchProgress state={runner} onCancel={runner.cancel} onDismiss={runner.reset} />
          <div className="btn-row">
            <button className="btn" onClick={spec.undo} disabled={!spec.canUndo} title="Undo (⌘Z)">
              <Icon name="undo" /> Undo
            </button>
            <button className="btn" onClick={() => spec.reset()} title="Reset all resize settings">
              <Icon name="reset" /> Reset
            </button>
            <button className="btn primary" style={{ flex: 1 }} disabled={!file || runner.running || !!planError} onClick={doExport}>
              Export {plan ? `${plan.outputW} × ${plan.outputH}` : ''}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
