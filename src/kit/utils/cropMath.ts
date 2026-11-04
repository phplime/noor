/**
 * Interactive crop geometry, in source-image pixel coordinates.
 * Pure functions so they can be unit tested without a DOM.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

/** Width / height, or null for freeform. */
export type Ratio = number | null;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Parse "590:300", "16x9", "1.91/1". Returns null for invalid input. */
export function parseRatio(s: string): { w: number; h: number } | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return null;
  return { w, h };
}

/** Largest rect of the given ratio inside the bounds, centred. */
export function maxRectForRatio(bounds: Size, ratio: Ratio): Rect {
  if (ratio === null) return { x: 0, y: 0, w: bounds.w, h: bounds.h };
  let w = bounds.w;
  let h = w / ratio;
  if (h > bounds.h) {
    h = bounds.h;
    w = h * ratio;
  }
  return { x: (bounds.w - w) / 2, y: (bounds.h - h) / 2, w, h };
}

/** Re-shape a rect to a ratio around its centre, staying inside bounds. */
export function applyRatio(rect: Rect, ratio: Ratio, bounds: Size): Rect {
  if (ratio === null) return clampRect(rect, bounds);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // keep roughly the same area
  const area = Math.max(rect.w * rect.h, 1);
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  const max = maxRectForRatio(bounds, ratio);
  if (w > max.w || h > max.h) {
    w = max.w;
    h = max.h;
  }
  const x = clamp(cx - w / 2, 0, bounds.w - w);
  const y = clamp(cy - h / 2, 0, bounds.h - h);
  return { x, y, w, h };
}

export function clampRect(r: Rect, bounds: Size, min = 1): Rect {
  const w = clamp(r.w, min, bounds.w);
  const h = clamp(r.h, min, bounds.h);
  return { x: clamp(r.x, 0, bounds.w - w), y: clamp(r.y, 0, bounds.h - h), w, h };
}

/**
 * Compute the rect after dragging `handle` by (dx, dy) source pixels from `start`.
 * The result always lies within bounds and respects the ratio when given.
 */
export function dragRect(start: Rect, handle: Handle, dx: number, dy: number, ratio: Ratio, bounds: Size, min = 8): Rect {
  const minSize = Math.min(min, bounds.w, bounds.h);
  if (handle === 'move') {
    return {
      x: clamp(start.x + dx, 0, bounds.w - start.w),
      y: clamp(start.y + dy, 0, bounds.h - start.h),
      w: start.w,
      h: start.h,
    };
  }
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const hasE = handle.includes('e');
  const hasW = handle.includes('w');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  if (ratio === null) {
    let x0 = start.x;
    let y0 = start.y;
    let x1 = right;
    let y1 = bottom;
    if (hasW) x0 = clamp(start.x + dx, 0, x1 - minSize);
    if (hasE) x1 = clamp(right + dx, x0 + minSize, bounds.w);
    if (hasN) y0 = clamp(start.y + dy, 0, y1 - minSize);
    if (hasS) y1 = clamp(bottom + dy, y0 + minSize, bounds.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  const minW = Math.max(minSize, minSize * ratio);
  const isCorner = (hasE || hasW) && (hasN || hasS);
  if (isCorner) {
    // Opposite corner stays fixed.
    const ax = hasE ? start.x : right;
    const ay = hasS ? start.y : bottom;
    const propW = hasE ? start.w + dx : start.w - dx;
    const propH = hasS ? start.h + dy : start.h - dy;
    let w = Math.max(propW, propH * ratio);
    const availW = hasE ? bounds.w - ax : ax;
    const availH = hasS ? bounds.h - ay : ay;
    w = clamp(w, Math.min(minW, availW, availH * ratio), Math.min(availW, availH * ratio));
    const h = w / ratio;
    return { x: hasE ? ax : ax - w, y: hasS ? ay : ay - h, w, h };
  }

  if (hasE || hasW) {
    const cy = start.y + start.h / 2;
    const ax = hasE ? start.x : right;
    const availW = hasE ? bounds.w - ax : ax;
    const availH = 2 * Math.min(cy, bounds.h - cy);
    let w = hasE ? start.w + dx : start.w - dx;
    w = clamp(w, Math.min(minW, availW, availH * ratio), Math.min(availW, availH * ratio));
    const h = w / ratio;
    return { x: hasE ? ax : ax - w, y: cy - h / 2, w, h };
  }

  // n / s
  const cx = start.x + start.w / 2;
  const ay = hasS ? start.y : bottom;
  const availH = hasS ? bounds.h - ay : ay;
  const availW = 2 * Math.min(cx, bounds.w - cx);
  let h = hasS ? start.h + dy : start.h - dy;
  h = clamp(h, Math.min(minW / ratio, availH, availW / ratio), Math.min(availH, availW / ratio));
  const w = h * ratio;
  return { x: cx - w / 2, y: hasS ? ay : ay - h, w, h };
}

/** Integer crop rectangle for export: inside bounds, at least 1×1. */
export function toCropSpec(r: Rect, bounds: Size): { x: number; y: number; width: number; height: number } {
  const x = clamp(Math.round(r.x), 0, bounds.w - 1);
  const y = clamp(Math.round(r.y), 0, bounds.h - 1);
  const width = clamp(Math.round(r.w), 1, bounds.w - x);
  const height = clamp(Math.round(r.h), 1, bounds.h - y);
  return { x, y, width, height };
}

/** Output size when the crop is resized to an exact width (height follows ratio). */
export function outputForExactWidth(width: number, ratio: number): { w: number; h: number } {
  return { w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(width / ratio)) };
}
