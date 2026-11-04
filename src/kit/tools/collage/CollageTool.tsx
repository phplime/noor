import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, EmptyDrop, LazyThumb } from '../../components/FileQueue';
import { Checkbox, ColorField, Field, NumberField, Section, Segmented, Select, Slider } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useShortcut } from '../../hooks/useShortcut';
import { ZoomControls, useZoom } from '../../components/PreviewStage';
import { getThumbnail, renderPreview } from '../../services/image-processing';
import { chooseImageDestination, exportCollage, shadowParams, type CollageSpec } from '../../services/creative';
import { savedFileActions } from '../../services/file-export';
import { AppError } from '../../services/ipc';
import type { AdjustSpec, ScannedFile } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { isIOS } from '../../utils/platform';
import { basename, formatBytes } from '../../utils/format';
import { CANVAS_PRESETS, cellRects, framing, layoutsFor, MAX_COLLAGE_PHOTOS } from './layouts';
import { COLLAGE_EFFECTS, FRAME_STYLES } from './styles';

const MAX_PHOTOS = MAX_COLLAGE_PHOTOS;

interface Frame {
  focusX: number;
  focusY: number;
  zoom: number;
}

const DEFAULT_FRAME: Frame = { focusX: 0.5, focusY: 0.5, zoom: 1 };

function CellImage({ file, cellW, cellH, fit, frame, scale, effect }: { file: ScannedFile; cellW: number; cellH: number; fit: 'cover' | 'contain'; frame: Frame; scale: number; effect: AdjustSpec | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const effectKey = effect ? JSON.stringify(effect) : '';
  useEffect(() => {
    let live = true;
    // With an effect, the preview is rendered by the same engine as the export.
    const load = effect ? renderPreview(file.path, [{ type: 'adjust', ...effect }], 1400) : getThumbnail(file.path, 1400);
    load.then((t) => live && setSrc(t.dataUrl)).catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, effectKey]);
  const f = framing(cellW, cellH, file.width, file.height, fit, frame.zoom, frame.focusX, frame.focusY);
  if (!src) return <div className="spinner" style={{ position: 'absolute', left: '50%', top: '50%' }} />;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{ position: 'absolute', left: f.offsetX * scale, top: f.offsetY * scale, width: f.drawW * scale, height: f.drawH * scale, maxWidth: 'none', pointerEvents: 'none' }}
    />
  );
}

export default function CollageTool({ active }: ToolProps) {
  const { notify } = useApp();
  const queue = useImportQueue();
  const files = queue.files.slice(0, MAX_PHOTOS);
  const [order, setOrder] = useState<string[]>([]);
  const [layoutId, setLayoutId] = useState<string>('');
  const [presetId, setPresetId] = useState('square');
  const [size, setSize] = useState({ w: 1080, h: 1080 });
  const [gap, setGap] = useState(12);
  const [margin, setMargin] = useState(12);
  const [radius, setRadius] = useState(0);
  const [bg, setBg] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [effectId, setEffectId] = useState('none');
  const [borderWidth, setBorderWidth] = useState(0);
  const [borderColor, setBorderColor] = useState('#ffffff');
  const [shadow, setShadow] = useState(0);
  const [styleId, setStyleId] = useState('clean');
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const [lastOutput, setLastOutput] = useState<{ path: string; bytes: number } | null>(null);

  useEffect(() => {
    if (queue.files.length > MAX_PHOTOS) notify({ kind: 'warning', title: `A collage can hold up to ${MAX_PHOTOS} photos`, message: `Only the first ${MAX_PHOTOS} are used.` });
  }, [queue.files.length, notify]);

  // Keep the photo order stable as photos are added/removed.
  useEffect(() => {
    setOrder((o) => {
      const paths = files.map((f) => f.path);
      return [...o.filter((p) => paths.includes(p)), ...paths.filter((p) => !o.includes(p))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.files]);

  const ordered = order.map((p) => files.find((f) => f.path === p)).filter((f): f is ScannedFile => !!f);
  const layouts = layoutsFor(ordered.length);
  const layout = layouts.find((l) => l.id === layoutId) ?? layouts[0];
  useEffect(() => setSelected(null), [layout?.id]);

  const rects = useMemo(() => (layout ? cellRects(layout.cells, size.w, size.h, margin, gap) : []), [layout, size, margin, gap]);
  const z = useZoom(size.w, size.h);
  const effect = COLLAGE_EFFECTS.find((e) => e.id === effectId)?.spec ?? null;
  const [shBlur, shDy, shOpacity] = shadowParams(size.w, size.h, shadow);

  const applyStyle = (id: string) => {
    const st = FRAME_STYLES.find((f) => f.id === id);
    if (!st) return;
    // Style values are designed for a 1080 px canvas; scale them to this canvas.
    const k = Math.min(size.w, size.h) / 1080;
    setStyleId(id);
    setBorderWidth(Math.round(st.borderWidth * k));
    setBorderColor(st.borderColor);
    setShadow(st.shadow);
    setRadius(Math.round(st.radius * k));
    setGap(Math.round(st.gap * k));
    setMargin(Math.round(st.margin * k));
    if (st.background) {
      setBg(st.background);
      setTransparent(false);
    }
  };
  const s = z.scale;

  const spec: CollageSpec | null =
    layout && ordered.length
      ? {
          width: size.w,
          height: size.h,
          background: bg,
          transparent,
          effect,
          borderWidth,
          borderColor,
          shadow,
          cells: rects.map((r, i) => {
            const f = ordered[i];
            const fr = frames[f.path] ?? DEFAULT_FRAME;
            return { path: f.path, x: r.x, y: r.y, w: r.w, h: r.h, focusX: fr.focusX, focusY: fr.focusY, zoom: fr.zoom, fit, radius };
          }),
        }
      : null;

  // ---- Dragging: pan a photo inside its cell, or drag the handle to swap cells ----
  const drag = useRef<{ kind: 'pan' | 'swap'; index: number; px: number; py: number; frame: Frame } | null>(null);
  const onPointerDown = (i: number, kind: 'pan' | 'swap') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(i);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, index: i, px: e.clientX, py: e.clientY, frame: frames[ordered[i].path] ?? DEFAULT_FRAME };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'pan') return;
    const f = ordered[d.index];
    const r = rects[d.index];
    const fr = framing(r.w, r.h, f.width, f.height, fit, d.frame.zoom, d.frame.focusX, d.frame.focusY);
    const freeX = r.w - fr.drawW;
    const freeY = r.h - fr.drawH;
    const dx = (e.clientX - d.px) / s;
    const dy = (e.clientY - d.py) / s;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    setFrames((all) => ({
      ...all,
      [f.path]: {
        ...d.frame,
        focusX: Math.abs(freeX) > 0.5 ? clamp(d.frame.focusX + dx / freeX) : d.frame.focusX,
        focusY: Math.abs(freeY) > 0.5 ? clamp(d.frame.focusY + dy / freeY) : d.frame.focusY,
      },
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind !== 'swap') return;
    const target = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.cell !== undefined) as HTMLElement | undefined;
    const to = target ? Number(target.dataset.cell) : -1;
    if (to >= 0 && to !== d.index) {
      setOrder((o) => {
        const next = [...o];
        [next[d.index], next[to]] = [next[to], next[d.index]];
        return next;
      });
      setSelected(to);
    }
  };

  const doExport = async () => {
    if (!spec || busy) return;
    try {
      const dest = await chooseImageDestination(`collage-${size.w}x${size.h}.${transparent ? 'png' : 'jpg'}`, ['jpg', 'png', 'webp']);
      if (!dest) return;
      setBusy(true);
      const r = await exportCollage(spec, dest, quality);
      setLastOutput({ path: r.path, bytes: r.bytes });
      notify({ kind: 'success', title: `Saved ${basename(r.path)}`, message: `${size.w} × ${size.h} px (verified) · ${formatBytes(r.bytes)}`, actions: savedFileActions([r.path], notify) });
    } catch (e) {
      notify({ kind: 'error', title: 'Collage not saved', message: AppError.from(e).message });
    } finally {
      setBusy(false);
    }
  };
  useShortcut('mod+enter', () => void doExport(), active);

  const selFile = selected !== null ? ordered[selected] : null;
  const selFrame = selFile ? (frames[selFile.path] ?? DEFAULT_FRAME) : null;

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn" onClick={queue.addFiles} title="Add photos (⌘O)" disabled={files.length >= MAX_PHOTOS}>
          <Icon name="plus" /> Photos
        </button>
        <button className="btn primary" disabled={!spec || busy} onClick={() => void doExport()} title="Save collage (⌘↩)">
          {busy ? 'Saving…' : 'Save Collage…'}
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active} label="Drop photos to add them" />
        {!ordered.length ? (
          <EmptyDrop queue={queue} title="Make a photo collage" description="Choose 2 to 12 photos, pick a layout and canvas size, then drag photos to reframe or swap them." />
        ) : (
          <div className="stage">
            <div className="stage-bar">
              <span className="small muted">
                <Icon name="move" size={12} style={{ verticalAlign: -2 }} /> Drag a photo to reframe it · drag ⠿ onto another cell to swap
              </span>
              <span className="spacer" />
              <ZoomControls z={z} />
            </div>
            <div className="stage-viewport" ref={z.viewport} onPointerDown={() => setSelected(null)}>
              <div
                className={`stage-canvas${transparent ? ' checker' : ''}`}
                style={{ width: size.w * s, height: size.h * s, background: transparent ? undefined : bg }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {rects.map((r, i) => {
                  const f = ordered[i];
                  if (!f) return null;
                  return (
                    <div
                      key={i}
                      data-cell={i}
                      className={`collage-cell${selected === i ? ' selected' : ''}`}
                      style={{
                        left: r.x * s,
                        top: r.y * s,
                        width: r.w * s,
                        height: r.h * s,
                        borderRadius: Math.min(radius, r.w / 2, r.h / 2) * s,
                        boxShadow: shadow > 0 ? `0 ${shDy * s}px ${shBlur * 2 * s}px rgba(0,0,0,${shOpacity})` : undefined,
                      }}
                      onPointerDown={onPointerDown(i, 'pan')}
                    >
                      <CellImage file={f} cellW={r.w} cellH={r.h} fit={fit} frame={frames[f.path] ?? DEFAULT_FRAME} scale={s} effect={effect} />
                      {borderWidth > 0 && (
                        <span
                          className="collage-border"
                          style={{ borderWidth: Math.max(0.5, borderWidth * s), borderColor, borderRadius: Math.min(radius, r.w / 2, r.h / 2) * s }}
                        />
                      )}
                      <span className="collage-handle" title="Drag onto another cell to swap" onPointerDown={onPointerDown(i, 'swap')}>
                        ⠿
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="stage-status">
              Output <strong className="mono">{size.w} × {size.h}</strong> px · {ordered.length} photos
            </div>
          </div>
        )}
      </div>

      <aside className="inspector" aria-label="Collage settings">
        <Section title={`Photos (${ordered.length}/${MAX_PHOTOS})`} aside={<button className="btn ghost small" onClick={queue.clear} disabled={!files.length}>Clear</button>}>
          <div className="collage-thumbs">
            {ordered.map((f, i) => (
              <div key={f.path} className={`collage-thumb${selected === i ? ' selected' : ''}`} onClick={() => setSelected(i)} title={f.name}>
                <LazyThumb path={f.path} size={52} />
                <button className="collage-thumb-x" aria-label={`Remove ${f.name}`} onClick={(e) => { e.stopPropagation(); queue.remove(f.path); }}>
                  ×
                </button>
              </div>
            ))}
            {ordered.length < MAX_PHOTOS && (
              <button className="collage-add" onClick={queue.addFiles} title="Add photos">
                <Icon name="plus" />
              </button>
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn small" disabled={ordered.length < 2} onClick={() => setOrder((o) => [...o].sort(() => Math.random() - 0.5))}>
              Shuffle
            </button>
          </div>
        </Section>

        {layouts.length > 0 && (
          <Section title="Layout">
            <div className="layout-picker">
              {layouts.map((l) => (
                <button key={l.id} className={`layout-option${layout?.id === l.id ? ' active' : ''}`} title={l.label} onClick={() => setLayoutId(l.id)}>
                  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
                    {l.cells.map(([x, y, w, h], i) => (
                      <rect key={i} x={x * 40 + 1.5} y={y * 40 + 1.5} width={w * 40 - 3} height={h * 40 - 3} rx="2" />
                    ))}
                  </svg>
                  <span>{l.label}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Effect">
          <div className="chips" role="radiogroup" aria-label="Photo effect">
            {COLLAGE_EFFECTS.map((e) => (
              <button key={e.id} role="radio" aria-checked={effectId === e.id} className={`chip${effectId === e.id ? ' active' : ''}`} title={e.description} onClick={() => setEffectId(e.id)}>
                {e.label}
              </button>
            ))}
          </div>
          <p className="field-hint">Applied to every photo, using the same engine as Adjust & Enhance.</p>
        </Section>

        <Section title="Frame & border">
          <div className="chips" role="radiogroup" aria-label="Frame style">
            {FRAME_STYLES.map((f) => (
              <button key={f.id} role="radio" aria-checked={styleId === f.id} className={`chip${styleId === f.id ? ' active' : ''}`} onClick={() => applyStyle(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <Field label="Photo border">
            <Slider value={borderWidth} min={0} max={80} onChange={(v) => (setBorderWidth(v), setStyleId(''))} format={(v) => (v ? `${v}px` : 'None')} ariaLabel="Border width" />
          </Field>
          {borderWidth > 0 && <ColorField label="Border color" value={borderColor} onChange={(c) => (setBorderColor(c), setStyleId(''))} />}
          <Field label="Shadow">
            <Slider value={shadow} min={0} max={100} onChange={(v) => (setShadow(v), setStyleId(''))} format={(v) => (v ? `${v}%` : 'None')} ariaLabel="Shadow strength" />
          </Field>
          {shadow > 0 && gap === 0 && margin === 0 && <p className="field-hint">Add spacing or a margin to see the shadow.</p>}
        </Section>

        <Section title="Canvas">
          <Select<string>
            value={presetId}
            onChange={(id) => {
              setPresetId(id);
              const p = CANVAS_PRESETS.find((x) => x.id === id);
              if (p) setSize({ w: p.w, h: p.h });
            }}
            options={[...CANVAS_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom size' }]}
          />
          {presetId === 'custom' && (
            <div className="row" style={{ marginTop: 8 }}>
              <NumberField label="Width" unit="px" value={size.w} min={100} max={8000} onChange={(w) => setSize((x) => ({ ...x, w }))} />
              <NumberField label="Height" unit="px" value={size.h} min={100} max={8000} onChange={(h) => setSize((x) => ({ ...x, h }))} />
            </div>
          )}
          <Field label="Photos">
            <Segmented<'cover' | 'contain'>
              value={fit}
              onChange={setFit}
              options={[
                { value: 'cover', label: 'Fill cells', title: 'Photos fill their cells; edges may be hidden (drag to reframe)' },
                { value: 'contain', label: 'Whole photo', title: 'Every photo is shown completely; empty space shows the background' },
              ]}
            />
          </Field>
          <Field label="Spacing">
            <Slider value={gap} min={0} max={200} onChange={setGap} format={(v) => `${v}px`} ariaLabel="Spacing between photos" />
          </Field>
          <Field label="Outer margin">
            <Slider value={margin} min={0} max={300} onChange={setMargin} format={(v) => `${v}px`} ariaLabel="Outer margin" />
          </Field>
          <Field label="Rounded corners">
            <Slider value={radius} min={0} max={300} onChange={setRadius} format={(v) => `${v}px`} ariaLabel="Corner radius" />
          </Field>
          <div className="field">
            <Checkbox checked={transparent} onChange={setTransparent} label="Transparent background (PNG/WebP)" />
          </div>
          {!transparent && <ColorField label="Background" value={bg} onChange={setBg} />}
        </Section>

        {selFile && selFrame && (
          <Section title="Selected photo" aside={<button className="btn ghost small" onClick={() => setFrames((a) => ({ ...a, [selFile.path]: DEFAULT_FRAME }))}>Reset</button>}>
            <div className="small muted truncate" style={{ marginBottom: 6 }}>{selFile.name}</div>
            <Field label="Zoom">
              <Slider value={Math.round(selFrame.zoom * 100)} min={100} max={400} onChange={(v) => setFrames((a) => ({ ...a, [selFile.path]: { ...selFrame, zoom: v / 100 } }))} format={(v) => `${v}%`} ariaLabel="Zoom" />
            </Field>
            <p className="field-hint">Drag the photo in the preview to choose which part is shown.</p>
          </Section>
        )}

        <Section title="Save">
          <Field label="JPEG / WebP quality">
            <Slider value={quality} min={50} max={100} onChange={setQuality} ariaLabel="Quality" />
          </Field>
          <p className="field-hint">The file type comes from the name you choose (.jpg, .png or .webp). Photos are drawn from the full-resolution originals.</p>
          {lastOutput && (
            <div className="save-row" style={{ marginTop: 8 }}>
              {savedFileActions([lastOutput.path], notify).map((a, i) => (
                <button key={a.label} className={`btn${i === 0 && isIOS() ? ' primary' : ''}`} onClick={a.run}>
                  <Icon name={i === 0 && isIOS() ? 'image' : 'folderOpen'} /> {a.label}
                </button>
              ))}
            </div>
          )}
        </Section>

        <div className="inspector-footer">
          <button className="btn primary large" disabled={!spec || busy} onClick={() => void doExport()}>
            {busy ? 'Saving…' : `Save Collage (${size.w} × ${size.h})…`}
          </button>
        </div>
      </aside>
    </div>
  );
}
