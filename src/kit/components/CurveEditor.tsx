import { useMemo, useRef, useState } from 'react';
import type { CurvePoints } from '../types/engine';
import { insertPoint, makeCurve, movePoint } from '../utils/curve';

const SIZE = 248;
const PAD = 8;
const INNER = SIZE - PAD * 2;

const toPx = (v: number) => PAD + v * INNER;
const fromPx = (px: number) => Math.min(1, Math.max(0, (px - PAD) / INNER));

/**
 * Interactive tone curve. Click to add a point, drag to shape the curve,
 * double-click a point to remove it. Left = shadows, right = highlights;
 * pulling up brightens that tonal range, pulling down darkens it.
 */
export function CurveEditor({ points, onChange, color = 'var(--text)' }: { points: CurvePoints; onChange: (p: CurvePoints) => void; color?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const pts = points.length >= 2 ? points : ([[0, 0], [1, 1]] as CurvePoints);

  const path = useMemo(() => {
    const f = makeCurve(pts);
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += `${i ? 'L' : 'M'}${toPx(x).toFixed(1)},${toPx(1 - f(x)).toFixed(1)}`;
    }
    return d;
  }, [pts]);

  const local = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const sx = SIZE / r.width;
    return { x: fromPx((e.clientX - r.left) * sx), y: 1 - fromPx((e.clientY - r.top) * sx) };
  };

  return (
    <svg
      ref={svg}
      className="curve-editor"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="Tone curve. Click to add a point, drag points, double-click to remove."
      onPointerDown={(e) => {
        if ((e.target as Element).tagName === 'circle') return;
        const p = local(e);
        if (pts.length >= 16) return;
        const { points: next, index } = insertPoint(pts, [p.x, p.y]);
        onChange(next);
        dragging.current = index;
        setActive(index);
        svg.current!.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (dragging.current === null) return;
        const p = local(e);
        onChange(movePoint(pts, dragging.current, p.x, p.y));
      }}
      onPointerUp={() => {
        dragging.current = null;
      }}
    >
      <rect x={PAD} y={PAD} width={INNER} height={INNER} className="curve-bg" />
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} className="curve-grid">
          <line x1={toPx(g)} y1={PAD} x2={toPx(g)} y2={SIZE - PAD} />
          <line x1={PAD} y1={toPx(g)} x2={SIZE - PAD} y2={toPx(g)} />
        </g>
      ))}
      <line x1={PAD} y1={SIZE - PAD} x2={SIZE - PAD} y2={PAD} className="curve-diagonal" />
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={toPx(x)}
          cy={toPx(1 - y)}
          r={active === i ? 6 : 5}
          className="curve-point"
          style={{ stroke: color }}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragging.current = i;
            setActive(i);
            svg.current!.setPointerCapture(e.pointerId);
          }}
          onDoubleClick={() => {
            if (i === 0 || i === pts.length - 1) return;
            onChange(pts.filter((_, j) => j !== i));
            setActive(null);
          }}
        >
          <title>
            In {Math.round(x * 255)} → Out {Math.round(y * 255)}
            {i > 0 && i < pts.length - 1 ? ' (double-click to remove)' : ''}
          </title>
        </circle>
      ))}
    </svg>
  );
}
