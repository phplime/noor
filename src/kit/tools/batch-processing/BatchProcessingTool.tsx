import { useMemo } from 'react';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop, FileQueue } from '../../components/FileQueue';
import { ExportPanel } from '../../components/ExportPanel';
import { LayoutLegend, PreviewStage } from '../../components/PreviewStage';
import { ResizeControls } from '../../components/ResizeControls';
import { DoesNotFit } from '../../components/DoesNotFit';
import { BatchProgress } from '../../components/BatchProgress';
import { Callout, Section } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useExportRunner } from '../../hooks/useExportRunner';
import { useUndoable } from '../../hooks/useUndoable';
import { useShortcut } from '../../hooks/useShortcut';
import { useOnSettingsLoaded, useToolExport } from '../../hooks/useToolExport';
import { DEFAULT_RESIZE, resizeOp } from '../../services/image-processing';
import type { ResizeSpec } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { formatDims, stem } from '../../utils/format';
import { isMobile } from '../../utils/platform';

const TOOL_ID = 'batch-processing';

export default function BatchProcessingTool({ active }: ToolProps) {
  const { settings } = useApp();
  const queue = useImportQueue();
  const file = queue.selectedFile;
  const spec = useUndoable<ResizeSpec>(DEFAULT_RESIZE);
  const [exportOpts, setExportOpts] = useToolExport(TOOL_ID, '-{w}x{h}');
  const runner = useExportRunner(TOOL_ID);
  useOnSettingsLoaded(() =>
    spec.replace({ ...DEFAULT_RESIZE, mode: settings.defaultResizeMode, background: { color: settings.defaultBackground, transparent: false } }, true),
  );

  const operations = useMemo(() => [resizeOp(spec.value)], [spec.value]);
  const s = spec.value;
  const tooLarge =
    s.mode === 'canvas' && !s.scaleImage ? queue.files.filter((f) => f.width > s.width || f.height > s.height) : [];
  const count = queue.files.length;

  const doExport = () => {
    if (!count || runner.running) return;
    void runner.run(queue.files.map((f) => ({ path: f.path, relDir: f.relDir })), operations, exportOpts);
  };
  useShortcut('mod+enter', doExport, active);
  useShortcut('mod+z', spec.undo, active);
  useShortcut('escape', () => void runner.cancel(), active && runner.running);

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn" onClick={queue.addFiles} title="Add images (⌘O)">
          <Icon name="plus" /> Images
        </button>
        <button className="btn" onClick={queue.addFolder} title={isMobile() ? 'Add images from the Files app' : 'Add folder (⇧⌘O)'}>
          <Icon name="folder" /> {isMobile() ? 'Files' : 'Folder'}
        </button>
        <button className="btn primary" disabled={!count || runner.running} onClick={doExport} title="Process all (⌘↩)">
          Process {count || ''} {count === 1 ? 'Image' : 'Images'}
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active} />
        {!count ? (
          <EmptyDrop queue={queue} title="Batch resize and pad images" description="Every image gets the same output settings — for example all at exactly 1200 × 628 with padding, without cropping anything. Originals are never modified." />
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              {file && (
                <PreviewStage
                  file={file}
                  operations={operations}
                  showLayout
                  extraBar={<span className="small muted">Preview of the selected image</span>}
                  renderError={(e) => (
                    <DoesNotFit error={e} onScale={() => spec.set({ ...s, scaleImage: true })} onEnlarge={(w, h) => spec.set({ ...s, width: w, height: h })} />
                  )}
                />
              )}
            </div>
            <div style={{ height: 230, flex: 'none' }}>
              <FileQueue queue={queue} statuses={runner.statuses} busy={runner.running} />
            </div>
          </>
        )}
      </div>

      <aside className="inspector" aria-label="Batch settings">
        <div className="section" style={{ paddingBottom: 0, borderBottom: 0 }}>
          <LayoutLegend />
        </div>
        <ResizeControls value={s} onChange={spec.set} source={file ? { w: file.width, h: file.height } : undefined} maxDimension={settings.limits.maxDimension} />

        {tooLarge.length > 0 && (
          <Section title="Check before processing">
            <Callout kind="warning">
              <span>
                {tooLarge.length} of {count} images are larger than the {formatDims(s.width, s.height)} canvas. With “Scale image down” off they can't fit without cropping, so they will be reported as failed.
              </span>
              <div className="btn-row">
                <button className="btn primary" onClick={() => spec.set({ ...s, scaleImage: true })}>
                  Scale large images down
                </button>
              </div>
            </Callout>
          </Section>
        )}

        <ExportPanel
          value={exportOpts}
          onChange={setExportOpts}
          sourceFormats={[...new Set(queue.files.map((f) => f.format))]}
          introducesAlpha={s.background.transparent && (s.mode === 'fit' || s.mode === 'canvas')}
          sample={file ? { stem: stem(file.name), w: s.mode === 'percent' ? Math.round((file.width * s.percent) / 100) : s.width, h: s.mode === 'percent' ? Math.round((file.height * s.percent) / 100) : s.height, format: file.format } : undefined}
        />

        <div className="inspector-footer">
          <BatchProgress state={runner} onCancel={runner.cancel} onDismiss={runner.reset} />
          <div className="btn-row">
            <button className="btn" onClick={spec.undo} disabled={!spec.canUndo} title="Undo (⌘Z)">
              <Icon name="undo" /> Undo
            </button>
            <button className="btn" onClick={() => spec.reset()}>
              <Icon name="reset" /> Reset
            </button>
            <button className="btn primary" style={{ flex: 1 }} disabled={!count || runner.running} onClick={doExport}>
              Process {count} {count === 1 ? 'Image' : 'Images'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
