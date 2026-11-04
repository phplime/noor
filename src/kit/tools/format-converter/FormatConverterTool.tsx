import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop, FileQueue } from '../../components/FileQueue';
import { ExportPanel } from '../../components/ExportPanel';
import { BatchProgress } from '../../components/BatchProgress';
import { Section } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useExportRunner } from '../../hooks/useExportRunner';
import { useShortcut } from '../../hooks/useShortcut';
import { useToolExport } from '../../hooks/useToolExport';
import { FORMAT_INFO, resolveFormat } from '../../services/file-export';
import type { OutputFormat } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { formatBytes, formatDims, stem } from '../../utils/format';
import { isMobile } from '../../utils/platform';

const TOOL_ID = 'format-converter';

const TARGETS: { value: Exclude<OutputFormat, 'source'>; label: string; note: string }[] = [
  { value: 'png', label: 'PNG', note: 'Lossless · transparency' },
  { value: 'jpeg', label: 'JPEG', note: 'Small photos · no transparency' },
  { value: 'webp', label: 'WebP', note: 'Small · transparency' },
  { value: 'tiff', label: 'TIFF', note: 'Lossless · large' },
  { value: 'bmp', label: 'BMP', note: 'Uncompressed' },
];

export default function FormatConverterTool({ active }: ToolProps) {
  const queue = useImportQueue();
  const [exportOpts, setExportOpts] = useToolExport(TOOL_ID, '', { format: 'webp' });
  const runner = useExportRunner(TOOL_ID);
  const count = queue.files.length;
  const target = exportOpts.format === 'source' ? 'png' : exportOpts.format;
  const sameFormat = queue.files.filter((f) => resolveFormat(target, f.format) === f.format).length;
  const lossyFromAlpha = !FORMAT_INFO[target].alpha && queue.files.some((f) => f.format !== 'jpeg' && f.format !== 'bmp');

  const doExport = () => {
    if (!count || runner.running) return;
    void runner.run(queue.files.map((f) => ({ path: f.path, relDir: f.relDir })), [], { ...exportOpts, format: target });
  };
  useShortcut('mod+enter', doExport, active);
  useShortcut('escape', () => void runner.cancel(), active && runner.running);

  const file = queue.selectedFile;

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn" onClick={queue.addFiles} title="Add images (⌘O)">
          <Icon name="plus" /> Images
        </button>
        <button className="btn" onClick={queue.addFolder} title={isMobile() ? 'Add images from your device' : 'Add folder (⇧⌘O)'}>
          <Icon name="folder" /> {isMobile() ? 'Files' : 'Folder'}
        </button>
        <button className="btn primary" disabled={!count || runner.running} onClick={doExport} title="Convert all (⌘↩)">
          Convert to {FORMAT_INFO[target].label}
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active} />
        {!count ? (
          <EmptyDrop queue={queue} title="Convert image formats" description="PNG ↔ JPEG ↔ WebP, plus TIFF and BMP. Pixel dimensions are kept; transparency is preserved where the target format supports it." />
        ) : (
          <FileQueue queue={queue} statuses={runner.statuses} busy={runner.running} title="Images to convert" />
        )}
      </div>

      <aside className="inspector" aria-label="Conversion settings">
        <Section title="Convert to">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }} role="radiogroup" aria-label="Target format">
            {TARGETS.map((t) => (
              <button
                key={t.value}
                role="radio"
                aria-checked={target === t.value}
                className={`btn${target === t.value ? ' primary' : ''}`}
                style={{ height: 'auto', padding: '8px 10px', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}
                onClick={() => setExportOpts({ ...exportOpts, format: t.value })}
              >
                <strong>{t.label}</strong>
                <span className="small" style={{ opacity: 0.8, fontWeight: 400 }}>
                  {t.note}
                </span>
              </button>
            ))}
          </div>
          {lossyFromAlpha && (
            <p className="field-hint" style={{ marginTop: 8 }}>
              {FORMAT_INFO[target].label} does not support transparency — pick the fill color under Output.
            </p>
          )}
          {sameFormat > 0 && (
            <p className="field-hint" style={{ marginTop: 8 }}>
              {sameFormat} image(s) are already {FORMAT_INFO[target].label}; they will be re-encoded with the settings below.
            </p>
          )}
        </Section>

        {file && (
          <Section title="Selected image">
            <dl className="kv">
              <dt>Input</dt>
              <dd>
                {FORMAT_INFO[file.format].label} · <span className="mono">{formatDims(file.width, file.height)}</span> · {formatBytes(file.size)}
              </dd>
              <dt>Output</dt>
              <dd>
                {FORMAT_INFO[resolveFormat(target, file.format)].label} · <span className="mono">{formatDims(file.width, file.height)}</span> ·{' '}
                {runner.statuses.get(file.path)?.outputBytes ? formatBytes(runner.statuses.get(file.path)!.outputBytes) : 'size measured after export'}
              </dd>
            </dl>
          </Section>
        )}

        <ExportPanel
          value={{ ...exportOpts, format: target }}
          onChange={setExportOpts}
          hideFormat
          title="Output"
          sourceFormats={[...new Set(queue.files.map((f) => f.format))]}
          sample={file ? { stem: stem(file.name), w: file.width, h: file.height, format: file.format } : undefined}
        />

        <div className="inspector-footer">
          <BatchProgress state={runner} onCancel={runner.cancel} onDismiss={runner.reset} showSizes />
          <button className="btn primary large" disabled={!count || runner.running} onClick={doExport}>
            Convert {count} {count === 1 ? 'Image' : 'Images'} to {FORMAT_INFO[target].label}
          </button>
        </div>
      </aside>
    </div>
  );
}
