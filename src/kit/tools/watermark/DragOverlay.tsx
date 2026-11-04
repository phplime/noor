import { useEffect, useRef, useState } from 'react';
import type { MarkLayout, MarkRect, Placement } from '../../types/engine';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Custom placement fractions that put a mark's top-left at (x, y). Mirrors the engine. */
export function placementForPosition(layout: MarkLayout, x: number, y: number): Placement {
  const freeW = layout.area.w - layout.rect.w;
  const freeH = layout.area.h - layout.rect.h;
  return {
    anchor: 'custom',
    x: freeW > 0 ? clamp((x - layout.area.x) / freeW, 0, 1) : 0.5,
    y: freeH > 0 ? clamp((y - layout.area.y) / freeH, 0, 1) : 0.5,
  };
}

/** Clamp a dragged position so the mark stays inside its movable area. */
export function clampToArea(layout: MarkLayout, x: number, y: number): { x: number; y: number } {
  const { area, rect } = layout;
  return {
    x: area.w > rect.w ? clamp(x, area.x, area.x + area.w - rect.w) : area.x + (area.w - rect.w) / 2,
    y: area.h > rect.h ? clamp(y, area.y, area.y + area.h - rect.h) : area.y + (area.h - rect.h) / 2,
  };
}

/**
 * Drag the watermark directly on the preview. The box follows the pointer
 * instantly; the placement (custom X/Y) is updated as you drag and the engine
 * re-renders the preview, so what you see is what gets exported.
 */
export function WatermarkDragOverlay({ layout, scale, onMove }: { layout: MarkLayout; scale: number; onMove: (p: Placement) => void }) {
  const [live, setLive] = useState<MarkRect | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  // A fresh engine layout replaces the local drag rectangle once dragging ends.
  useEffect(() => {
    if (!drag.current) setLive(null);
  }, [layout]);
  const r = live ?? layout.rect;

  const moveTo = (x: number, y: number) => {
    const p = clampToArea(layout, x, y);
    setLive({ ...layout.rect, x: p.x, y: p.y });
    onMove(placementForPosition(layout, p.x, p.y));
  };

  return (
    <div
      className="wm-drag"
      role="slider"
      tabIndex={0}
      aria-label="Watermark position. Drag, or use the arrow keys."
      aria-valuetext={`${Math.round(r.x)}, ${Math.round(r.y)} pixels`}
      title="Drag to position the watermark"
      style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { px: e.clientX, py: e.clientY, x: r.x, y: r.y };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        moveTo(d.x + (e.clientX - d.px) / scale, d.y + (e.clientY - d.py) / scale);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const d = map[e.key];
        if (!d) return;
        e.preventDefault();
        moveTo(r.x + d[0], r.y + d[1]);
      }}
    >
      <span className="wm-drag-hint">Drag to move</span>
    </div>
  );
}
