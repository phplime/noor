import { useRef, useState } from 'react';
import type { MaskStroke } from '../../types/engine';

export type MaskTool = 'view' | 'pick' | 'keep' | 'erase';

interface Props {
  /** Display scale (screen px per image px) and image size in image px. */
  scale: number;
  width: number;
  height: number;
  tool: MaskTool;
  /** Brush radius as a fraction of the shorter side. */
  brush: number;
  picks: [number, number][];
  strokes: MaskStroke[];
  showStrokes: boolean;
  onPick: (p: [number, number]) => void;
  onRemovePick: (index: number) => void;
  onStroke: (s: MaskStroke) => void;
}

const KEEP = 'rgba(48, 164, 108, 0.45)';
const ERASE = 'rgba(229, 72, 77, 0.45)';

/**
 * Interactive layer over the preview: click to choose subjects, paint to add to or
 * erase from the subject. Everything is stored in normalised (0–1) coordinates so
 * it applies identically to the preview and the full-resolution export.
 */
export function MaskOverlay({ scale, width, height, tool, brush, picks, strokes, showStrokes, onPick, onRemovePick, onStroke }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<MaskStroke | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const W = width * scale;
  const H = height * scale;
  const shortPx = Math.min(W, H);
  const rPx = brush * shortPx;

  const norm = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool === 'view' || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = norm(e);
    if (tool === 'pick') {
      onPick(p);
      return;
    }
    ref.current!.setPointerCapture(e.pointerId);
    setLive({ keep: tool === 'keep', radius: brush, points: [p] });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = norm(e);
    setHover(p);
    if (!live) return;
    const last = live.points[live.points.length - 1];
    // Add a point once the pointer has moved a quarter of the brush radius.
    const dx = (p[0] - last[0]) * W;
    const dy = (p[1] - last[1]) * H;
    if (Math.hypot(dx, dy) >= Math.max(1, rPx * 0.25)) setLive({ ...live, points: [...live.points, p] });
  };

  const onUp = () => {
    if (live) onStroke(live);
    setLive(null);
  };

  const strokeEl = (s: MaskStroke, i: number | string, opacity = 1) => {
    const width = Math.max(1, 2 * s.radius * shortPx);
    const color = s.keep ? KEEP : ERASE;
    if (s.points.length === 1) {
      return <circle key={i} cx={s.points[0][0] * W} cy={s.points[0][1] * H} r={width / 2} fill={color} opacity={opacity} />;
    }
    return (
      <polyline
        key={i}
        points={s.points.map(([x, y]) => `${x * W},${y * H}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
    );
  };

  const brushing = tool === 'keep' || tool === 'erase';
  return (
    <div
      ref={ref}
      className={`mask-overlay tool-${tool}`}
      style={{ pointerEvents: tool === 'view' ? 'none' : 'auto' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={W} height={H} aria-hidden="true">
        {(showStrokes || brushing) && strokes.map((s, i) => strokeEl(s, i, brushing ? 0.9 : 0.5))}
        {live && strokeEl(live, 'live')}
        {brushing && hover && !live && <circle cx={hover[0] * W} cy={hover[1] * H} r={rPx} fill="none" stroke="#fff" strokeWidth={1.5} style={{ filter: 'drop-shadow(0 0 1px #000)' }} />}
      </svg>
      {(tool === 'pick' || tool === 'view') &&
        picks.map(([x, y], i) => (
          <button
            key={i}
            className="pick-marker"
            style={{ left: x * W, top: y * H, pointerEvents: tool === 'pick' ? 'auto' : 'none' }}
            title="Remove this subject from the selection"
            onPointerDown={(e) => {
              e.stopPropagation();
              onRemovePick(i);
            }}
          >
            {i + 1}
          </button>
        ))}
    </div>
  );
}
