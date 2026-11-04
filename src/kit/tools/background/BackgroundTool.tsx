import { useCallback, useMemo, useState } from 'react';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop, FileQueue } from '../../components/FileQueue';
import { ExportPanel } from '../../components/ExportPanel';
import { PreviewStage } from '../../components/PreviewStage';
import { BatchProgress } from '../../components/BatchProgress';
import { Callout, Checkbox, ColorField, Field, Section, Segmented, Slider } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useExportRunner } from '../../hooks/useExportRunner';
import { useShortcut } from '../../hooks/useShortcut';
import { useToolExport } from '../../hooks/useToolExport';
import { resolveFormat } from '../../services/file-export';
import type { AppError } from '../../services/ipc';
import type { BackgroundSpec, BgMode, MaskStroke, Operation } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { stem } from '../../utils/format';
import { MaskOverlay, type MaskTool } from './MaskOverlay';
import { isMobile } from '../../utils/platform';

const TOOL_ID = 'background';

type Shared = Omit<BackgroundSpec, 'picks' | 'strokes'>;
interface Edits {
  picks: [number, number][];
  strokes: MaskStroke[];
}
const NO_EDITS: Edits = { picks: [], strokes: [] };

const DEFAULTS: Shared = {
  detect: true,
  subject: 'auto',
  invert: false,
  refine: true,
  tolerance: 6,
  edge: 0,
  feather: 0,
  mode: 'transparent',
  color: '#ffffff',
  blur: 55,
  lens: true,
  highlights: 35,
};

const MODES: { value: BgMode; label: string; title: string; suffix: string }[] = [
  { value: 'transparent', label: 'Remove', title: 'Transparent background (PNG / WebP)', suffix: '-cutout' },
  { value: 'blur', label: 'Blur (DSLR)', title: 'Shallow depth of field: the background is lens-blurred, the subject stays sharp', suffix: '-portrait' },
  { value: 'color', label: 'Color', title: 'Put the subject on a solid color', suffix: '-bg' },
  { value: 'grayscale', label: 'B&W splash', title: 'Black & white background, color subject', suffix: '-splash' },
];

const SUBJECT_MODES: { value: Shared['subject']; label: string; title: string }[] = [
  { value: 'auto', label: 'Auto', title: 'Plain background → logo & graphics mode; otherwise photo subject detection' },
  { value: 'graphic', label: 'Logo & graphics', title: 'Logos, text, icons, screenshots, products on a plain background — keeps every shape and letter' },
  { value: 'subjects', label: 'Photo', title: 'The main subjects of a photo: people, pets, products, objects (Apple Vision, macOS 14 or later)' },
  { value: 'people', label: 'People', title: 'People only, with fine hair detail (Apple Vision, macOS 12 or later)' },
];

const BG_SWATCHES = ['#ffffff', '#000000', '#f2f2f2', '#e8e1d5', '#4a90d9', '#d6e9ff', '#e5484d', '#30a46c'];

export default function BackgroundTool({ active }: ToolProps) {
  const queue = useImportQueue();
  const file = queue.selectedFile;
  const [cfg, setCfgState] = useState<Shared>(DEFAULTS);
  const setCfg = (patch: Partial<Shared>) => setCfgState((c) => ({ ...c, ...patch }));
  const [edits, setEdits] = useState<Record<string, Edits>>({});
  const [history, setHistory] = useState<Record<string, Edits[]>>({});
  const [tool, setTool] = useState<MaskTool>('view');
  const [brush, setBrush] = useState(0.03);
  const [showStrokes, setShowStrokes] = useState(true);
  const [exportOpts, setExportOpts] = useToolExport(TOOL_ID, '-cutout', { format: 'png' });
  const runner = useExportRunner(TOOL_ID);
  const count = queue.files.length;

  const cur = (file && edits[file.path]) || NO_EDITS;
  const update = useCallback(
    (fn: (e: Edits) => Edits) => {
      if (!file) return;
      const before = edits[file.path] ?? NO_EDITS;
      setHistory((h) => ({ ...h, [file.path]: [...(h[file.path] ?? []), before].slice(-100) }));
      setEdits((all) => ({ ...all, [file.path]: fn(before) }));
    },
    [file, edits],
  );
  const undo = () => {
    if (!file) return;
    const stack = history[file.path] ?? [];
    if (!stack.length) return;
    setEdits((all) => ({ ...all, [file.path]: stack[stack.length - 1] }));
    setHistory((h) => ({ ...h, [file.path]: stack.slice(0, -1) }));
  };

  const specFor = useCallback((e: Edits): Operation => ({ type: 'background', ...cfg, picks: e.picks, strokes: e.strokes }), [cfg]);
  const operations = useMemo(() => [specFor(cur)], [specFor, cur]);

  const outFormat = file ? resolveFormat(exportOpts.format, file.format) : 'png';
  const loseTransparency = cfg.mode === 'transparent' && (outFormat === 'jpeg' || outFormat === 'bmp');

  const doExport = () => {
    if (!count || runner.running) return;
    const items = queue.files.map((f) => {
      const e = edits[f.path];
      const custom = e && (e.picks.length || e.strokes.length);
      return { path: f.path, relDir: f.relDir, operations: custom ? [specFor(e)] : undefined };
    });
    void runner.run(items, [specFor(NO_EDITS)], exportOpts);
  };
  useShortcut('mod+enter', doExport, active);
  useShortcut('mod+z', undo, active);
  useShortcut('escape', () => (runner.running ? void runner.cancel() : setTool('view')), active);

  const setMode = (mode: BgMode) => {
    setCfg({ mode });
    const m = MODES.find((x) => x.value === mode)!;
    // Transparent needs PNG/WebP; the other looks are fine as JPEG.
    setExportOpts({ ...exportOpts, suffix: m.suffix, format: mode === 'transparent' && (exportOpts.format === 'jpeg' || exportOpts.format === 'bmp') ? 'png' : exportOpts.format });
  };

  const renderError = (e: AppError) =>
    e.code === 'segmentation' ? (
      <Callout kind="warning">
        <p style={{ margin: '0 0 8px' }}>{e.message}</p>
        <div className="btn-row">
          <button className="btn small" onClick={() => setCfg({ subject: 'graphic' })}>
            Use logo & graphics mode
          </button>
          {cfg.subject !== 'people' && (
            <button className="btn small" onClick={() => setCfg({ subject: 'people' })}>
              Detect people instead
            </button>
          )}
          <button
            className="btn small"
            onClick={() => {
              setCfg({ detect: false });
              setTool('keep');
            }}
          >
            Paint the subject by hand
          </button>
        </div>
      </Callout>
    ) : (
      <Callout kind="danger">{e.message}</Callout>
    );

  const toolHint: Record<MaskTool, string> = {
    view: !cfg.detect
      ? 'Automatic detection is off — paint the subject with the Keep brush.'
      : cfg.subject === 'auto'
        ? 'Auto: images with a plain background (logos, graphics, product shots) keep every shape and letter; photos use subject detection.'
        : 'The subject is found automatically. Use the tools to refine it.',
    pick: 'Click what to keep — a person, an object, or a part of a logo (an icon, a word). Click a number to remove it.',
    keep: 'Paint over parts that should stay (subject).',
    erase: 'Paint over parts that should be removed (background).',
  };

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
            title="Remove or blur backgrounds"
            description="Noor finds the subject — people, pets, products, anything — using Apple's on-device Vision. Remove the background, put the subject on a color, or blur it like a DSLR portrait. Nothing is uploaded."
          />
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              {file && (
                <PreviewStage
                  file={file}
                  operations={operations}
                  renderError={renderError}
                  extraBar={
                    <div className="mask-tools" role="toolbar" aria-label="Selection tools">
                      <Segmented<MaskTool>
                        value={tool}
                        onChange={setTool}
                        ariaLabel="Selection tool"
                        options={[
                          { value: 'view', label: 'View', title: 'Look at the result' },
                          { value: 'pick', label: 'Pick subject', title: 'Click the subject(s) to keep', icon: 'wand' },
                          { value: 'keep', label: 'Keep', title: 'Brush: add to the subject', icon: 'plus' },
                          { value: 'erase', label: 'Erase', title: 'Brush: remove from the subject', icon: 'x' },
                        ]}
                      />
                      <button className="btn ghost small" onClick={undo} disabled={!(file && history[file.path]?.length)} title="Undo (⌘Z)">
                        <Icon name="undo" />
                      </button>
                    </div>
                  }
                  overlay={({ scale, result }) => (
                    <MaskOverlay
                      scale={scale}
                      width={result.plan.outputW}
                      height={result.plan.outputH}
                      tool={tool}
                      brush={brush}
                      picks={cur.picks}
                      strokes={cur.strokes}
                      showStrokes={showStrokes}
                      onPick={(p) => update((e) => ({ ...e, picks: [...e.picks, p] }))}
                      onRemovePick={(i) => update((e) => ({ ...e, picks: e.picks.filter((_, j) => j !== i) }))}
                      onStroke={(s) => update((e) => ({ ...e, strokes: [...e.strokes, s] }))}
                    />
                  )}
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

      <aside className="inspector" aria-label="Background settings">
        <Section title="Background">
          <div className="chips" role="radiogroup" aria-label="Background">
            {MODES.map((m) => (
              <button key={m.value} role="radio" aria-checked={cfg.mode === m.value} className={`chip${cfg.mode === m.value ? ' active' : ''}`} title={m.title} onClick={() => setMode(m.value)}>
                {m.label}
              </button>
            ))}
          </div>
          {cfg.mode === 'color' && (
            <div style={{ marginTop: 10 }}>
              <ColorField label="Color" value={cfg.color} onChange={(color) => setCfg({ color })} />
              <div className="swatch-row">
                {BG_SWATCHES.map((c) => (
                  <button key={c} className={`swatch${cfg.color.toLowerCase() === c ? ' active' : ''}`} style={{ background: c }} title={c} aria-label={`Background ${c}`} onClick={() => setCfg({ color: c })} />
                ))}
              </div>
            </div>
          )}
          {cfg.mode === 'blur' && (
            <div style={{ marginTop: 10 }}>
              <Field label="Blur amount">
                <Slider value={cfg.blur} min={0} max={100} onChange={(blur) => setCfg({ blur })} ariaLabel="Blur amount" />
              </Field>
              <Field label="Lens">
                <Segmented<'lens' | 'smooth'>
                  value={cfg.lens ? 'lens' : 'smooth'}
                  onChange={(v) => setCfg({ lens: v === 'lens' })}
                  options={[
                    { value: 'lens', label: 'Bokeh', title: 'Round, camera-like out-of-focus highlights' },
                    { value: 'smooth', label: 'Smooth', title: 'Soft Gaussian blur' },
                  ]}
                />
              </Field>
              <Field label="Highlight bloom">
                <Slider value={cfg.highlights} min={0} max={100} onChange={(highlights) => setCfg({ highlights })} ariaLabel="Highlight bloom" />
              </Field>
              <p className="field-hint">Bright points in the background (lights, sun through leaves) bloom into bokeh balls, like a fast lens.</p>
            </div>
          )}
          {loseTransparency && <Callout kind="warning">{outFormat.toUpperCase()} can't store transparency — the background will be filled. Choose PNG or WebP below.</Callout>}
        </Section>

        <Section title="Subject">
          <div className="field">
            <Checkbox checked={cfg.detect} onChange={(detect) => setCfg({ detect })} label="Find the subject automatically" />
          </div>
          {cfg.detect && (
            <Field label="Image type">
              <div className="chips" role="radiogroup" aria-label="Image type">
                {SUBJECT_MODES.map((m) => (
                  <button key={m.value} role="radio" aria-checked={cfg.subject === m.value} className={`chip${cfg.subject === m.value ? ' active' : ''}`} title={m.title} onClick={() => setCfg({ subject: m.value })}>
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <p className="field-hint">{toolHint[tool]}</p>
          {cfg.detect && (cfg.subject === 'graphic' || cfg.subject === 'auto') && (
            <Field label="Background tolerance" info="Logos & graphics on a plain background: how different a colour must be from the background to be kept. Raise it if faint shadows or noise remain; lower it if pale parts disappear.">
              <Slider value={cfg.tolerance} min={0} max={40} onChange={(tolerance) => setCfg({ tolerance })} format={(v) => `${v}%`} ariaLabel="Background tolerance" />
            </Field>
          )}
          {cfg.detect && cfg.subject !== 'people' && (
            <div className="btn-row" style={{ marginBottom: 8 }}>
              <button className={`btn small${tool === 'pick' ? ' primary' : ''}`} onClick={() => setTool(tool === 'pick' ? 'view' : 'pick')}>
                <Icon name="wand" /> Pick subjects
              </button>
              <span className="small muted">{cur.picks.length ? `${cur.picks.length} picked` : 'Everything kept'}</span>
              {cur.picks.length > 0 && (
                <button className="btn ghost small" onClick={() => update((e) => ({ ...e, picks: [] }))}>
                  Use all
                </button>
              )}
            </div>
          )}
          <Field label="Brush size">
            <Slider value={Math.round(brush * 1000)} min={5} max={150} onChange={(v) => setBrush(v / 1000)} format={(v) => `${(v / 10).toFixed(1)}%`} ariaLabel="Brush size" />
          </Field>
          <div className="btn-row">
            <button className={`btn small${tool === 'keep' ? ' primary' : ''}`} onClick={() => setTool(tool === 'keep' ? 'view' : 'keep')}>
              <Icon name="plus" /> Keep brush
            </button>
            <button className={`btn small${tool === 'erase' ? ' primary' : ''}`} onClick={() => setTool(tool === 'erase' ? 'view' : 'erase')}>
              <Icon name="x" /> Erase brush
            </button>
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <Checkbox checked={showStrokes} onChange={setShowStrokes} label="Show brush strokes" />
          </div>
          {(cur.picks.length > 0 || cur.strokes.length > 0) && (
            <button className="btn ghost small" onClick={() => update(() => NO_EDITS)}>
              <Icon name="reset" /> Clear picks & strokes for this photo
            </button>
          )}
          {count > 1 && <p className="field-hint">Picks and brush strokes belong to each photo. Other photos use automatic detection.</p>}
        </Section>

        <Section title="Edges" aside={<button className="btn ghost small" onClick={() => setCfg({ refine: true, edge: 0, feather: 0, invert: false })}>Reset</button>}>
          {cfg.subject !== 'graphic' && (
            <div className="field">
              <Checkbox checked={cfg.refine} onChange={(refine) => setCfg({ refine })} label="Refine edges (hair & fur — photos)" />
            </div>
          )}
          <Field label="Shrink / grow">
            <Slider value={cfg.edge} min={-20} max={20} onChange={(edge) => setCfg({ edge })} format={(v) => (v > 0 ? `+${v}` : `${v}`)} ariaLabel="Shrink or grow the subject" />
          </Field>
          <Field label="Soften edge">
            <Slider value={cfg.feather} min={0} max={30} onChange={(feather) => setCfg({ feather })} ariaLabel="Soften edge" />
          </Field>
          <div className="field">
            <Checkbox checked={cfg.invert} onChange={(invert) => setCfg({ invert })} label="Invert (remove the subject, keep the background)" />
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
          <button className="btn primary large" disabled={!count || runner.running} onClick={doExport}>
            Export {count > 1 ? `${count} Images` : 'Image'}
          </button>
        </div>
      </aside>
    </div>
  );
}
