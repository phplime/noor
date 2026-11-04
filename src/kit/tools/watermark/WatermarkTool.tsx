import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop, FileQueue } from '../../components/FileQueue';
import { ExportPanel } from '../../components/ExportPanel';
import { PreviewStage } from '../../components/PreviewStage';
import { BatchProgress } from '../../components/BatchProgress';
import { AlignmentGrid } from '../../components/AlignmentGrid';
import { Callout, Checkbox, ColorField, Field, NumberField, Section, Segmented, Slider } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { WatermarkDragOverlay } from './DragOverlay';
import { useExportRunner } from '../../hooks/useExportRunner';
import { useUndoable } from '../../hooks/useUndoable';
import { useShortcut } from '../../hooks/useShortcut';
import { useOnSettingsLoaded, useToolExport } from '../../hooks/useToolExport';
import { DEFAULT_WATERMARK, getThumbnail, placementAt, watermarkOp } from '../../services/image-processing';
import { pickImageFiles } from '../../services/file-import';
import { AppError } from '../../services/ipc';
import type { SizeUnit, WatermarkKind, WatermarkSpec } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { basename, formatDims, stem } from '../../utils/format';
import { isMobile } from '../../utils/platform';

const TOOL_ID = 'watermark';

interface LogoInfo {
  path: string;
  w: number;
  h: number;
  dataUrl: string;
  hasAlpha: boolean;
}

export default function WatermarkTool({ active }: ToolProps) {
  const { settings, notify } = useApp();
  const queue = useImportQueue();
  const file = queue.selectedFile;
  const wm = useUndoable<WatermarkSpec>(DEFAULT_WATERMARK);
  const [logo, setLogo] = useState<LogoInfo | null>(null);
  const [exportOpts, setExportOpts] = useToolExport(TOOL_ID, '-watermarked');
  const runner = useExportRunner(TOOL_ID);
  const set = (patch: Partial<WatermarkSpec>) => wm.set({ ...wm.value, ...patch });
  const v = wm.value;

  useOnSettingsLoaded(() =>
    wm.replace({ ...DEFAULT_WATERMARK, opacity: settings.defaultWatermarkOpacity, placement: placementAt(settings.defaultWatermarkAnchor) }, true),
  );

  const chooseLogo = async () => {
    try {
      const [path] = await pickImageFiles(false, 'Choose a logo (transparent PNG recommended)');
      if (!path) return;
      const t = await getThumbnail(path, 256);
      setLogo({ path, w: t.width, h: t.height, dataUrl: t.dataUrl, hasAlpha: t.hasAlpha });
      set({ kind: 'logo', logoPath: path, logoWidth: Math.min(t.width, 400), logoHeight: Math.round((Math.min(t.width, 400) * t.height) / t.width) });
    } catch (e) {
      notify({ kind: 'error', title: 'Could not open the logo', message: AppError.from(e).message });
    }
  };

  const ready = v.kind === 'logo' ? !!v.logoPath : v.text.trim().length > 0;
  const operations = useMemo(() => (ready ? [watermarkOp(wm.value)] : []), [wm.value, ready]);

  const doExport = () => {
    if (!queue.files.length || runner.running) return;
    if (!ready) {
      notify({ kind: 'warning', title: v.kind === 'logo' ? 'Choose a logo first' : 'Enter the watermark text first' });
      return;
    }
    void runner.run(queue.files.map((f) => ({ path: f.path, relDir: f.relDir })), operations, exportOpts);
  };
  useShortcut('mod+enter', doExport, active);
  useShortcut('mod+z', wm.undo, active);
  useShortcut('escape', () => void runner.cancel(), active && runner.running);

  const unitOptions = [
    { value: 'percentOfWidth' as SizeUnit, label: '% of width', title: 'Scales with each image — best for batches with different sizes' },
    { value: 'pixels' as SizeUnit, label: 'Pixels' },
  ];
  const count = queue.files.length;

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn" onClick={queue.addFiles} title="Add images (⌘O)">
          <Icon name="plus" /> Images
        </button>
        <button className="btn" onClick={queue.addFolder} title={isMobile() ? 'Add images from your device' : 'Add folder (⇧⌘O)'}>
          <Icon name="folder" /> {isMobile() ? 'Files' : 'Folder'}
        </button>
        <button className="btn primary" disabled={!count || runner.running || !ready} onClick={doExport} title="Process all (⌘↩)">
          Watermark {count > 1 ? `${count} Images` : 'Image'}
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active} />
        {!count ? (
          <EmptyDrop queue={queue} title="Add a logo or text watermark" description="Add one image, many images or a whole folder. The same watermark settings are applied to every image; originals are never modified." />
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              {file &&
                (ready ? (
                  <PreviewStage
                    file={file}
                    operations={operations}
                    extraBar={<span className="small muted"><Icon name="move" size={12} style={{ verticalAlign: -2 }} /> Drag the watermark to position it</span>}
                    overlay={({ scale, result }) =>
                      result.marks[0] ? <WatermarkDragOverlay layout={result.marks[0]} scale={scale} onMove={(placement) => set({ placement })} /> : null
                    }
                  />
                ) : (
                  <div className="dropzone" style={{ borderStyle: 'solid' }}>
                    <Icon name={v.kind === 'logo' ? 'image' : 'text'} size={28} />
                    <h2>{v.kind === 'logo' ? 'Choose a logo to see the preview' : 'Type your watermark text'}</h2>
                    {v.kind === 'logo' && (
                      <button className="btn primary" onClick={chooseLogo}>
                        Choose Logo…
                      </button>
                    )}
                  </div>
                ))}
            </div>
            <div style={{ height: 210, flex: 'none' }}>
              <FileQueue queue={queue} statuses={runner.statuses} busy={runner.running} />
            </div>
          </>
        )}
      </div>

      <aside className="inspector" aria-label="Watermark settings">
        <Section title="Watermark">
          <Segmented<WatermarkKind>
            value={v.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { value: 'logo', label: 'Logo image', icon: 'image' },
              { value: 'text', label: 'Text', icon: 'text' },
            ]}
          />
        </Section>

        {v.kind === 'logo' ? (
          <Section title="Logo">
            {logo && v.logoPath === logo.path ? (
              <div className="row" style={{ alignItems: 'center' }}>
                <div className={`thumb none${logo.hasAlpha ? ' checker' : ''}`} style={{ width: 56, height: 56 }}>
                  <img src={logo.dataUrl} alt="Logo preview" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="file-name truncate" title={logo.path}>
                    {basename(logo.path)}
                  </div>
                  <div className="file-meta">
                    <span>{formatDims(logo.w, logo.h)}</span>
                    <span>{logo.hasAlpha ? 'Transparent' : 'No transparency'}</span>
                  </div>
                </div>
                <button className="btn none" onClick={chooseLogo}>
                  Change…
                </button>
              </div>
            ) : (
              <button className="btn primary block" onClick={chooseLogo}>
                <Icon name="image" /> Choose Logo…
              </button>
            )}
            {logo && !logo.hasAlpha && v.logoPath === logo.path && (
              <div className="field">
                <Callout kind="neutral">This logo has no transparent areas, so its full rectangle will be visible. Use a transparent PNG for a cut-out logo.</Callout>
              </div>
            )}
            <Field label="Size">
              <Segmented<SizeUnit> value={v.logoSizeUnit} onChange={(logoSizeUnit) => set({ logoSizeUnit })} options={unitOptions} />
            </Field>
            {v.logoSizeUnit === 'percentOfWidth' ? (
              <Field label="Logo width">
                <Slider value={v.logoPercent} min={1} max={100} onChange={(logoPercent) => set({ logoPercent })} format={(x) => `${x}%`} ariaLabel="Logo width as percent of image width" />
              </Field>
            ) : (
              <>
                <div className="row">
                  <NumberField
                    label="Width"
                    unit="px"
                    value={v.logoWidth}
                    min={1}
                    max={20000}
                    onChange={(logoWidth) => set({ logoWidth, logoHeight: v.keepAspect && logo ? Math.max(1, Math.round((logoWidth * logo.h) / logo.w)) : v.logoHeight })}
                  />
                  <NumberField
                    label="Height"
                    unit="px"
                    value={v.keepAspect && logo ? Math.max(1, Math.round((v.logoWidth * logo.h) / logo.w)) : v.logoHeight}
                    min={1}
                    max={20000}
                    onChange={(logoHeight) => set({ logoHeight, logoWidth: v.keepAspect && logo ? Math.max(1, Math.round((logoHeight * logo.w) / logo.h)) : v.logoWidth })}
                  />
                </div>
                <div className="field">
                  <Checkbox checked={v.keepAspect} onChange={(keepAspect) => set({ keepAspect })} label="Keep logo proportions" />
                </div>
              </>
            )}
          </Section>
        ) : (
          <Section title="Text">
            <Field label="Text" hint="Press Return for multiple lines.">
              <textarea className="textarea" value={v.text} onChange={(e) => set({ text: e.target.value })} placeholder="© Your Name" spellCheck={false} />
            </Field>
            <Field label="Font size">
              <Segmented<SizeUnit> value={v.fontSizeUnit} onChange={(fontSizeUnit) => set({ fontSizeUnit, fontSize: fontSizeUnit === 'pixels' ? 48 : 4 })} options={unitOptions} />
            </Field>
            {v.fontSizeUnit === 'percentOfWidth' ? (
              <Slider value={v.fontSize} min={0.5} max={30} step={0.5} onChange={(fontSize) => set({ fontSize })} format={(x) => `${x}%`} ariaLabel="Font size" />
            ) : (
              <NumberField value={v.fontSize} unit="px" min={4} max={2000} onChange={(fontSize) => set({ fontSize })} ariaLabel="Font size in pixels" />
            )}
            <div className="row">
              <ColorField label="Color" value={v.color} onChange={(color) => set({ color })} swatches={false} />
              <div className="field none" style={{ justifyContent: 'flex-end', paddingBottom: 6 }}>
                <Checkbox checked={v.bold} onChange={(bold) => set({ bold })} label="Bold" />
              </div>
            </div>
            <p className="field-hint" style={{ marginTop: 8 }}>
              Uses the bundled DejaVu Sans font (Latin, Greek, Cyrillic and many symbols).
            </p>
          </Section>
        )}

        <Section title="Appearance">
          <Field label="Opacity">
            <Slider value={Math.round(v.opacity * 100)} min={0} max={100} onChange={(o) => set({ opacity: o / 100 })} format={(x) => `${x}%`} ariaLabel="Opacity" />
          </Field>
          <Field label="Position" hint="Tip: drag the watermark in the preview. Custom positions are relative, so they work for every image size in a batch.">
            <AlignmentGrid value={v.placement} onChange={(placement) => set({ placement })} />
          </Field>
          <Field label="Margin from edges">
            <Segmented<SizeUnit> value={v.marginUnit} onChange={(marginUnit) => set({ marginUnit, marginX: marginUnit === 'pixels' ? 24 : 2, marginY: marginUnit === 'pixels' ? 24 : 2 })} options={unitOptions} />
          </Field>
          <div className="row">
            <NumberField label="Horizontal" unit={v.marginUnit === 'pixels' ? 'px' : '%'} value={v.marginX} min={0} max={v.marginUnit === 'pixels' ? 10000 : 50} integer={v.marginUnit === 'pixels'} onChange={(marginX) => set({ marginX })} />
            <NumberField label="Vertical" unit={v.marginUnit === 'pixels' ? 'px' : '%'} value={v.marginY} min={0} max={v.marginUnit === 'pixels' ? 10000 : 50} integer={v.marginUnit === 'pixels'} onChange={(marginY) => set({ marginY })} />
          </div>
        </Section>

        <ExportPanel
          value={exportOpts}
          onChange={setExportOpts}
          sourceFormats={[...new Set(queue.files.map((f) => f.format))]}
          sample={file ? { stem: stem(file.name), w: file.width, h: file.height, format: file.format } : undefined}
        />

        <div className="inspector-footer">
          <BatchProgress state={runner} onCancel={runner.cancel} onDismiss={runner.reset} />
          <div className="btn-row">
            <button className="btn" onClick={wm.undo} disabled={!wm.canUndo} title="Undo (⌘Z)">
              <Icon name="undo" /> Undo
            </button>
            <button className="btn" onClick={() => wm.reset({ ...DEFAULT_WATERMARK, opacity: settings.defaultWatermarkOpacity, placement: placementAt(settings.defaultWatermarkAnchor), logoPath: v.logoPath })} title="Reset watermark settings (keeps the chosen logo)">
              <Icon name="reset" /> Reset
            </button>
            <button className="btn primary" style={{ flex: 1 }} disabled={!count || runner.running || !ready} onClick={doExport}>
              {count > 1 ? `Watermark ${count} Images` : 'Export'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
