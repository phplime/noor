import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop, FileQueue } from '../../components/FileQueue';
import { ExportPanel } from '../../components/ExportPanel';
import { PreviewStage } from '../../components/PreviewStage';
import { ResizeControls } from '../../components/ResizeControls';
import { BatchProgress } from '../../components/BatchProgress';
import { Callout, Checkbox, Section } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useExportRunner } from '../../hooks/useExportRunner';
import { useShortcut } from '../../hooks/useShortcut';
import { useToolExport } from '../../hooks/useToolExport';
import { useDebounced } from '../../hooks/useDebounced';
import { DEFAULT_RESIZE, measureOutput, resizeOp } from '../../services/image-processing';
import { AppError } from '../../services/ipc';
import type { Measured, Operation, ResizeSpec } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { formatBytes, formatDims, sizeChange, stem } from '../../utils/format';
import { isMobile } from '../../utils/platform';

const TOOL_ID = 'compression';

export default function CompressionTool({ active }: ToolProps) {
  const { settings } = useApp();
  const queue = useImportQueue();
  const file = queue.selectedFile;
  const [resizeOn, setResizeOn] = useState(false);
  const [spec, setSpec] = useState<ResizeSpec>({ ...DEFAULT_RESIZE, mode: 'within', width: 1920, height: 1920, allowUpscale: false });
  const [exportOpts, setExportOpts] = useToolExport(TOOL_ID, '-compressed', { quality: 75 });
  const runner = useExportRunner(TOOL_ID);
  const operations: Operation[] = useMemo(() => (resizeOn ? [resizeOp(spec)] : []), [resizeOn, spec]);
  const count = queue.files.length;

  // Real measurement for the selected image: encoded in memory with the exact settings.
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const measureKey = useDebounced(JSON.stringify({ p: file?.path, operations, e: exportOpts }), 350);
  useEffect(() => {
    if (!file || !active) return;
    let live = true;
    setMeasuring(true);
    measureOutput(file.path, operations, exportOpts)
      .then((m) => {
        if (!live) return;
        setMeasured(m);
        setMeasureError(null);
      })
      .catch((e) => live && (setMeasured(null), setMeasureError(AppError.from(e).message)))
      .finally(() => live && setMeasuring(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey, active]);

  const doExport = () => {
    if (!count || runner.running) return;
    void runner.run(queue.files.map((f) => ({ path: f.path, relDir: f.relDir })), operations, exportOpts);
  };
  useShortcut('mod+enter', doExport, active);
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
        <button className="btn primary" disabled={!count || runner.running} onClick={doExport} title="Compress all (⌘↩)">
          Compress {count || ''} {count === 1 ? 'Image' : 'Images'}
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active} />
        {!count ? (
          <EmptyDrop queue={queue} title="Make images smaller" description="Reduce file size with adjustable JPEG / WebP quality and lossless PNG optimization, optionally shrinking large images. Sizes are measured, never guessed." />
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              {file && <PreviewStage file={file} operations={operations} extraBar={<span className="small muted">Preview at screen resolution</span>} />}
            </div>
            <div style={{ height: 230, flex: 'none' }}>
              <FileQueue queue={queue} statuses={runner.statuses} busy={runner.running} />
            </div>
          </>
        )}
      </div>

      <aside className="inspector" aria-label="Compression settings">
        {file && (
          <Section title="Selected image" aside={measuring ? <span className="spinner" /> : null}>
            <dl className="kv">
              <dt>Original</dt>
              <dd>
                {formatBytes(file.size)} · <span className="mono">{formatDims(file.width, file.height)}</span>
              </dd>
              <dt>With these settings</dt>
              <dd>
                {measured ? (
                  <>
                    <strong>{formatBytes(measured.bytes)}</strong> · <span className="mono">{formatDims(measured.width, measured.height)}</span>{' '}
                    <span style={{ color: measured.bytes < measured.inputBytes ? 'var(--success)' : 'var(--warning)' }}>({sizeChange(measured.inputBytes, measured.bytes)})</span>
                  </>
                ) : measureError ? (
                  <span style={{ color: 'var(--danger)' }}>{measureError}</span>
                ) : (
                  '…'
                )}
              </dd>
            </dl>
            <p className="field-hint" style={{ marginTop: 6 }}>
              Measured by actually encoding this image in memory with the current settings. Other images will differ; final sizes are shown after export.
            </p>
            {measured && measured.bytes >= measured.inputBytes && (
              <div className="field">
                <Callout kind="warning">These settings make this file larger. Try a lower quality, WebP, or resizing.</Callout>
              </div>
            )}
          </Section>
        )}

        <Section title="Resize">
          <Checkbox checked={resizeOn} onChange={setResizeOn} label="Also resize images" />
          {!resizeOn && <p className="field-hint" style={{ marginTop: 6 }}>Images keep their pixel dimensions; only the encoding changes.</p>}
        </Section>
        {resizeOn && <ResizeControls value={spec} onChange={setSpec} source={file ? { w: file.width, h: file.height } : undefined} modes={['within', 'percent', 'stretch']} maxDimension={settings.limits.maxDimension} />}

        <ExportPanel
          value={exportOpts}
          onChange={setExportOpts}
          title="Format & quality"
          sourceFormats={[...new Set(queue.files.map((f) => f.format))]}
          sample={file && measured ? { stem: stem(file.name), w: measured.width, h: measured.height, format: file.format } : undefined}
        />

        <div className="inspector-footer">
          <BatchProgress state={runner} onCancel={runner.cancel} onDismiss={runner.reset} showSizes />
          <button className="btn primary large" disabled={!count || runner.running} onClick={doExport}>
            Compress {count} {count === 1 ? 'Image' : 'Images'}
          </button>
        </div>
      </aside>
    </div>
  );
}
