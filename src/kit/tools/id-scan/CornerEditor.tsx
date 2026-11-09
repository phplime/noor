import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { getThumbnail } from '../../services/image-processing';

export interface Pt {
  x: number;
  y: number;
}
/** TL, TR, BR, BL — 0..1 of the photo. */
export type Quad = [Pt, Pt, Pt, Pt];

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const LOUPE = 110; // px
const ZOOM = 3;

/**
 * Full-screen editor: the photo with the card's four corners. Drag a corner to fix it;
 * a magnifier shows exactly where it sits.
 */
export function CornerEditor({
  path,
  title,
  initial,
  detected,
  found,
  aspect,
  busy,
  onCancel,
  onDone,
}: {
  path: string;
  title: string;
  initial: Quad;
  detected: Quad;
  found: boolean;
  /** photo width / height */
  aspect: number;
  busy: boolean;
  onCancel: () => void;
  onDone: (q: Quad) => void;
}) {
  const [q, setQ] = useState<Quad>(initial);
  const [src, setSrc] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getThumbnail(path, 1600)
      .then((t) => live && setSrc(t.dataUrl))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path]);

  const move = (i: number, e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setQ((old) => {
      const next = [...old] as Quad;
      next[i] = { x, y };
      return next;
    });
  };

  const poly = q.map((p) => `${p.x},${p.y}`).join(' ');
  const active = drag != null ? q[drag] : null;

  return (
    <div className="idscan-editor" role="dialog" aria-label={`Corners of the ${title}`}>
      <header className="idscan-editor__bar">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <strong>{title}</strong>
        <button className="btn primary" onClick={() => onDone(q)} disabled={busy}>
          {busy ? 'Working…' : 'Done'}
        </button>
      </header>

      <p className="idscan-editor__hint">
        {found ? 'Card found — drag a corner if it isn’t exactly on the edge.' : 'Couldn’t find the card edges — drag the 4 corners onto the card’s corners.'}
      </p>

      <div className="idscan-editor__stage">
        <div ref={box} className="idscan-editor__photo" style={{ aspectRatio: String(aspect), width: `min(100%, calc((100dvh - 230px) * ${aspect}))` }}>
          {src ? <img src={src} alt="" draggable={false} /> : <div className="spinner" />}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <path d={`M0 0H1V1H0Z M${q.map((p) => `${p.x} ${p.y}`).join(' L')} Z`} fill="rgba(0,0,0,0.5)" fillRule="evenodd" />
            <polygon points={poly} fill="none" stroke="#2fb27f" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
          {q.map((p, i) => (
            <span
              key={i}
              className={`idscan-handle${drag === i ? ' is-drag' : ''}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setDrag(i);
              }}
              onPointerMove={(e) => drag === i && move(i, e)}
              onPointerUp={() => setDrag(null)}
              onPointerCancel={() => setDrag(null)}
              aria-label={['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'][i] + ' corner'}
              role="slider"
            />
          ))}
          {active && src && box.current && (
            <span
              className="idscan-loupe"
              style={{
                left: `${active.x * 100}%`,
                top: `${active.y * 100}%`,
                width: LOUPE,
                height: LOUPE,
                backgroundImage: `url(${src})`,
                backgroundSize: `${box.current.clientWidth * ZOOM}px ${box.current.clientHeight * ZOOM}px`,
                backgroundPosition: `${LOUPE / 2 - active.x * box.current.clientWidth * ZOOM}px ${LOUPE / 2 - active.y * box.current.clientHeight * ZOOM}px`,
              }}
            />
          )}
        </div>
      </div>

      <footer className="idscan-editor__tools">
        <button className="btn small" onClick={() => setQ(detected)} disabled={busy}>
          <Icon name="sparkles" size={13} /> Auto detect
        </button>
        <button className="btn small" onClick={() => setQ(FULL_QUAD)} disabled={busy}>
          Whole photo
        </button>
      </footer>
      <footer className="idscan-review__actions idscan-editor__done">
        <button className="btn large" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary large" onClick={() => onDone(q)} disabled={busy}>
          {busy ? 'Straightening…' : '✓ Done'}
        </button>
      </footer>
    </div>
  );
}
