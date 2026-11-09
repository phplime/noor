import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { Checkbox, Field, Section, Segmented, Slider } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { ZoomControls, useZoom } from '../../components/PreviewStage';
import { getThumbnail } from '../../services/image-processing';
import { chooseImageDestination, exportCollage, type CollageSpec } from '../../services/creative';
import { savedFileActions } from '../../services/file-export';
import { pickImageFiles, scanInputs } from '../../services/file-import';
import { AppError, call } from '../../services/ipc';
import type { ScannedFile } from '../../types/engine';
import type { ToolProps } from '../../navigation/types';
import { isIOS } from '../../utils/platform';
import { basename, formatBytes } from '../../utils/format';
import { DOC_TYPES, PAGE_H, PAGE_W, cornerRadius, docAspect, placeParts, type DocType } from './layout';
import { CornerEditor, FULL_QUAD, type Quad } from './CornerEditor';

type Slot = 'front' | 'back';
const SLOT_LABEL: Record<Slot, string> = { front: 'Front side', back: 'Back side' };

/** One side: the original photo, where its corners are, and the straightened card. */
interface Side {
  src: ScannedFile;
  corners: Quad;
  out: ScannedFile | null;
}

interface Detect {
  corners: Quad;
  found: boolean;
  width: number;
  height: number;
}

interface EditState {
  slot: Slot;
  /** editing a scan that is still waiting for approval */
  review?: boolean;
  src: ScannedFile;
  initial: Quad;
  detected: Quad;
  found: boolean;
  aspect: number;
}

interface ScanResult {
  paths?: string[];
  cancelled?: boolean;
  error?: string;
}

function PartImage({ file, fit = 'contain' }: { file: ScannedFile; fit?: 'contain' | 'cover' }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getThumbnail(file.path, 1400)
      .then((t) => live && setSrc(t.dataUrl))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file.path]);
  if (!src) return <div className="spinner" style={{ position: 'absolute', left: '50%', top: '50%' }} />;
  return <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }} />;
}

/** The iPhone document scanner (also on in the browser preview, where it returns samples). */
const canScan = () => isIOS() || !!import.meta.env.VITE_MOCK;

export default function IdScanTool({ active }: ToolProps) {
  const { notify } = useApp();
  const [parts, setParts] = useState<Record<Slot, Side | null>>({ front: null, back: null });
  const [type, setType] = useState<DocType>('nid');
  const [gap, setGap] = useState(20);
  const [clear, setClear] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  /** A fresh scan waiting for "Use this" / "Retake". `guided` = front, then ask for the back. */
  const [review, setReview] = useState<{ slot: Slot; side: Side; guided: boolean } | null>(null);
  const [askBack, setAskBack] = useState(false);
  const [lastOutput, setLastOutput] = useState<{ path: string; bytes: number } | null>(null);

  const shown = (sd: Side | null) => (sd ? (sd.out ?? sd.src) : null);
  const list = (['front', 'back'] as Slot[]).map((k) => shown(parts[k])).filter((f): f is ScannedFile => !!f);
  const rects = placeParts(list, type, gap);
  const z = useZoom(PAGE_W, PAGE_H);
  const s = z.scale;

  const load = async (paths: string[]): Promise<ScannedFile[]> => {
    if (!paths.length) return [];
    const res = await scanInputs(paths, false);
    return res.files;
  };

  /** Cut out, straighten to the document's shape and (optionally) clean up one side. */
  const straighten = async (src: ScannedFile, corners: Quad, docType = type, enhance = clear): Promise<ScannedFile | null> => {
    const out = await call<string>('idscan_straighten', { path: src.path, corners, aspect: docAspect(docType), enhance });
    return (await load([out]))[0] ?? null;
  };

  const setSide = (slot: Slot, side: Side | null) => {
    setParts((p) => ({ ...p, [slot]: side }));
    setLastOutput(null);
  };

  /** A new photo for a side: scanner pages are already cut out; photos get their corners found. */
  const addSource = async (slot: Slot, src: ScannedFile, alreadyCropped: boolean) => {
    if (alreadyCropped) {
      setSide(slot, { src, corners: FULL_QUAD, out: await straighten(src, FULL_QUAD) });
      return;
    }
    const d = await call<Detect>('idscan_detect', { path: src.path });
    if (d.found) setSide(slot, { src, corners: d.corners, out: await straighten(src, d.corners) });
    else setSide(slot, { src, corners: d.corners, out: null });
    // Always show the corners so they can be checked and dragged.
    setEdit({ slot, src, initial: d.corners, detected: d.corners, found: d.found, aspect: d.width / Math.max(1, d.height) });
  };

  const openEditor = async (slot: Slot) => {
    const sd = parts[slot];
    if (!sd) return;
    setBusy(slot);
    try {
      const d = await call<Detect>('idscan_detect', { path: sd.src.path });
      setEdit({ slot, src: sd.src, initial: sd.corners, detected: d.corners, found: d.found, aspect: d.width / Math.max(1, d.height) });
    } catch (e) {
      notify({ kind: 'error', title: 'Could not open the photo', message: AppError.from(e).message });
    } finally {
      setBusy(null);
    }
  };

  const finishEdit = async (corners: Quad) => {
    if (!edit) return;
    setBusy('edit');
    try {
      const side = { src: edit.src, corners, out: await straighten(edit.src, corners) };
      if (edit.review) setReview((r) => (r ? { ...r, side } : r));
      else setSide(edit.slot, side);
      setEdit(null);
    } catch (e) {
      notify({ kind: 'error', title: 'Could not straighten the card', message: AppError.from(e).message });
    } finally {
      setBusy(null);
    }
  };

  // Document type or "make clearer" changed: redo the straightened cards.
  const [redoKey, setRedoKey] = useState(`${type}:${clear}`);
  useEffect(() => {
    const key = `${type}:${clear}`;
    if (key === redoKey) return;
    setRedoKey(key);
    const sides = (['front', 'back'] as Slot[]).filter((k) => parts[k]);
    if (!sides.length) return;
    let live = true;
    setBusy('redo');
    void (async () => {
      for (const k of sides) {
        const sd = parts[k];
        if (!sd) continue;
        try {
          const out = await straighten(sd.src, sd.corners, type, clear);
          if (live) setSide(k, { ...sd, out });
        } catch {
          /* keep the old one */
        }
      }
      if (live) setBusy(null);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, clear]);

  /** Take ONE photo of a side (camera with a card-shaped guide), find the card, straighten it, then ask. */
  const scan = async (slot: Slot, guided = false) => {
    setBusy(slot);
    setAskBack(false);
    try {
      const r = await call<ScanResult>('capture_card', { passport: type === 'passport' });
      if (r?.error) throw new Error(r.error);
      const files = r?.paths?.length ? await load(r.paths) : [];
      const src = files[0];
      if (!src) return; // cancelled
      const d = await call<Detect>('idscan_detect', { path: src.path });
      const side: Side = { src, corners: d.corners, out: await straighten(src, d.corners) };
      setReview({ slot, side, guided });
      // Couldn't find the edges: go straight to the corners so they can be placed by hand.
      if (!d.found) setEdit({ slot, review: true, src, initial: d.corners, detected: d.corners, found: false, aspect: d.width / Math.max(1, d.height) });
    } catch (e) {
      notify({ kind: 'error', title: 'Camera', message: AppError.from(e).message });
    } finally {
      setBusy(null);
    }
  };

  const approve = () => {
    if (!review) return;
    setSide(review.slot, review.side);
    setReview(null);
    if (review.guided && review.slot === 'front') setAskBack(true);
  };

  const adjustReview = async () => {
    if (!review) return;
    setBusy('review');
    try {
      const d = await call<Detect>('idscan_detect', { path: review.side.src.path });
      setEdit({ slot: review.slot, review: true, src: review.side.src, initial: review.side.corners, detected: d.corners, found: d.found, aspect: d.width / Math.max(1, d.height) });
    } catch (e) {
      notify({ kind: 'error', title: 'Could not open the photo', message: AppError.from(e).message });
    } finally {
      setBusy(null);
    }
  };

  const choose = async (slot: Slot) => {
    setBusy(slot);
    try {
      const files = await load(await pickImageFiles(false, `Choose the ${SLOT_LABEL[slot].toLowerCase()}`));
      if (files[0]) await addSource(slot, files[0], false);
    } catch (e) {
      notify({ kind: 'error', title: 'Could not open the photo', message: AppError.from(e).message });
    } finally {
      setBusy(null);
    }
  };

  const swap = () => setParts((p) => ({ front: p.back, back: p.front }));

  const spec: CollageSpec | null = list.length
    ? {
        width: PAGE_W,
        height: PAGE_H,
        background: '#ffffff',
        transparent: false,
        effect: null,
        // A hairline edge so a white card stays visible on the white page, like a photocopy.
        borderWidth: 3,
        borderColor: '#d2d2d2',
        shadow: 0,
        cells: rects.map((r, i) => ({ path: list[i].path, x: r.x, y: r.y, w: r.w, h: r.h, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'cover' as const, radius: Math.round(r.w * cornerRadius(type)) })),
      }
    : null;

  const save = async () => {
    if (!spec || busy) return;
    try {
      const name = type === 'passport' ? 'passport-a4' : 'nid-a4';
      const dest = await chooseImageDestination(`${name}.jpg`, ['jpg', 'png']);
      if (!dest) return;
      setBusy('save');
      const r = await exportCollage(spec, dest, 95);
      setLastOutput({ path: r.path, bytes: r.bytes });
      notify({ kind: 'success', title: `Saved ${basename(r.path)}`, message: `A4 page, 300 dpi · ${formatBytes(r.bytes)}`, actions: savedFileActions([r.path], notify) });
    } catch (e) {
      notify({ kind: 'error', title: 'Page not saved', message: AppError.from(e).message });
    } finally {
      setBusy(null);
    }
  };

  const slotCard = (slot: Slot) => {
    const f = shown(parts[slot]);
    return (
      <div className="idscan-slot" key={slot}>
        <div className="idscan-slot__head">
          <strong>{SLOT_LABEL[slot]}</strong>
          {f && (
            <button className="btn ghost small" onClick={() => setParts((p) => ({ ...p, [slot]: null }))} aria-label={`Remove ${SLOT_LABEL[slot]}`}>
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
        <div className={`idscan-slot__pic${f ? '' : ' is-empty'}`}>{f ? <PartImage file={f} /> : <Icon name="image" size={22} />}</div>
        {f && (
          <button className="btn small idscan-slot__adjust" disabled={!!busy} onClick={() => void openEditor(slot)}>
            <Icon name="crop" size={13} /> {parts[slot]?.out ? 'Adjust corners' : 'Set corners'}
          </button>
        )}
        <div className="btn-row">
          {canScan() && (
            <button className="btn primary small" disabled={!!busy} onClick={() => void scan(slot)}>
              {busy === slot ? 'Scanning…' : f ? 'Scan again' : 'Scan'}
            </button>
          )}
          <button className={`btn small${canScan() ? '' : ' primary'}`} disabled={!!busy} onClick={() => void choose(slot)}>
            {canScan() ? 'Photo' : f ? 'Change…' : 'Choose…'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn primary" disabled={!spec || !!busy} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : 'Save A4 Page…'}
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <div className="stage">
          <div className="stage-bar">
            <span className="small muted">A4 page · white background · {list.length === 2 ? 'front on top, back below' : list.length ? 'add the other side' : 'scan the front and back'}</span>
            <span className="spacer" />
            <ZoomControls z={z} />
          </div>
          <div className="stage-viewport" ref={z.viewport}>
            <div className="stage-canvas idscan-page" style={{ width: PAGE_W * s, height: PAGE_H * s, background: '#ffffff' }}>
              {rects.map((r, i) => (
                <div key={list[i].path} className="idscan-part" style={{ left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s, borderRadius: r.w * s * cornerRadius(type) }}>
                  <PartImage file={list[i]} fit="cover" />
                </div>
              ))}
              {!list.length && (
                <div className="idscan-empty">
                  <Icon name="layers" size={28} />
                  <span>Your NID or passport copy will appear here</span>
                </div>
              )}
            </div>
          </div>
          <div className="stage-status">
            Output <strong className="mono">A4 · {PAGE_W} × {PAGE_H}</strong> px (300 dpi)
          </div>
        </div>
      </div>

      <aside className="inspector" aria-label="ID copy settings">
        <Section title="Sides" aside={<button className="btn ghost small" onClick={swap} disabled={!parts.front && !parts.back}>Swap</button>}>
          {canScan() && (
            <button className="btn primary idscan-guided" disabled={!!busy} onClick={() => void scan('front', true)}>
              <Icon name="crop" size={15} /> Scan card — front, then back
            </button>
          )}
          <div className="idscan-slots">{(['front', 'back'] as Slot[]).map(slotCard)}</div>
          {canScan() && <p className="field-hint">Scan finds the card's edges and straightens it; you check each side before it's used. With Photo, Noor finds the corners for you — drag them if needed.</p>}
        </Section>

        <Section title="Document">
          <Segmented<DocType> value={type} onChange={setType} options={DOC_TYPES.map((d) => ({ value: d.id, label: d.label, title: d.hint }))} ariaLabel="Document type" />
          <p className="field-hint">{DOC_TYPES.find((d) => d.id === type)?.hint}. Print at 100% (no “fit to page”) to get this size.</p>
          <Checkbox checked={clear} onChange={setClear} label="Make it clearer (brighter whites, sharper text)" />
          <Field label="Space between sides">
            <Slider value={gap} min={0} max={120} onChange={setGap} format={(v) => `${v}px`} ariaLabel="Space between sides" />
          </Field>
        </Section>

        <Section title="Save">
          <p className="field-hint">Saves a JPG (or PNG) A4 page. Share it to print, or send it as it is.</p>
          {lastOutput && (
            <div className="save-row" style={{ marginTop: 8 }}>
              {savedFileActions([lastOutput.path], notify).map((a, i) => (
                <button key={a.label} className={`btn${i === 0 && isIOS() ? ' primary' : ''}`} onClick={a.run}>
                  <Icon name={i === 0 && isIOS() ? 'share' : 'folderOpen'} /> {a.label}
                </button>
              ))}
            </div>
          )}
        </Section>

        <div className="inspector-footer">
          <button className="btn primary large" disabled={!spec || !!busy} onClick={() => void save()}>
            {busy === 'save' ? 'Saving…' : 'Save A4 Page…'}
          </button>
        </div>
      </aside>

      {createPortal(
        <>
      {review && !edit && (
        <div className="idscan-editor idscan-review" role="dialog" aria-label={`Check the ${SLOT_LABEL[review.slot].toLowerCase()}`}>
          <header className="idscan-editor__bar">
            <button className="btn ghost" onClick={() => setReview(null)} disabled={!!busy}>
              Cancel
            </button>
            <strong>{review.guided ? `Step ${review.slot === 'front' ? 1 : 2} of 2 · ` : ''}{SLOT_LABEL[review.slot]}</strong>
            <span style={{ width: 64 }} />
          </header>
          <p className="idscan-editor__hint">Is the whole card there, straight and sharp?</p>
          <div className="idscan-editor__stage">
            <div className="idscan-review__card" style={{ aspectRatio: String(docAspect(type)), borderRadius: `${cornerRadius(type) * 100}% / ${cornerRadius(type) * docAspect(type) * 100}%` }}>
              {review.side.out ? <PartImage file={review.side.out} fit="cover" /> : <div className="spinner" />}
            </div>
          </div>
          <footer className="idscan-review__actions">
            <button className="btn large" disabled={!!busy} onClick={() => void scan(review.slot, review.guided)}>
              ↺ Retake
            </button>
            <button className="btn large" disabled={!!busy} onClick={() => void adjustReview()}>
              <Icon name="crop" size={15} /> Corners
            </button>
            <button className="btn primary large" disabled={!!busy} onClick={approve}>
              ✓ {review.guided && review.slot === 'front' ? 'Use · next' : 'Use this'}
            </button>
          </footer>
        </div>
      )}

      {askBack && !review && !edit && (
        <div className="idscan-editor idscan-review" role="dialog" aria-label="Scan the back side">
          <div className="idscan-askback">
            <span className="idscan-askback__tick">✓</span>
            <strong>Front side saved</strong>
            <p>Now turn the card over and scan the back.</p>
            <button className="btn primary large" disabled={!!busy} onClick={() => void scan('back', true)}>
              Scan back side
            </button>
            <button className="btn ghost" onClick={() => setAskBack(false)}>
              Skip — front only
            </button>
          </div>
        </div>
      )}

      {edit && (
        <CornerEditor
          key={`${edit.slot}:${edit.src.path}`}
          path={edit.src.path}
          title={SLOT_LABEL[edit.slot]}
          initial={edit.initial}
          detected={edit.detected}
          found={edit.found}
          aspect={edit.aspect}
          busy={busy === 'edit'}
          onCancel={() => setEdit(null)}
          onDone={(q) => void finishEdit(q)}
        />
      )}
        </>,
        // Inside the kit's overlay layer so the kit styles apply, above the whole app.
        (document.querySelector('.n-kit-overlays') as HTMLElement | null) ?? document.body,
      )}
    </div>
  );
}
