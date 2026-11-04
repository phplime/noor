/** Collage layouts as fractional rectangles [x, y, w, h] of the inner area (0..1). */
export type FracRect = [number, number, number, number];

export interface Layout {
  id: string;
  label: string;
  cells: FracRect[];
}

const grid = (cols: number, rows: number, count = cols * rows): FracRect[] => {
  const out: FracRect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (out.length < count) out.push([c / cols, r / rows, 1 / cols, 1 / rows]);
  return out;
};

/** n cells in a row spanning [y, y+h]. */
const row = (n: number, y: number, h: number): FracRect[] => Array.from({ length: n }, (_, i) => [i / n, y, 1 / n, h] as FracRect);
const col = (n: number, x: number, w: number): FracRect[] => Array.from({ length: n }, (_, i) => [x, i / n, w, 1 / n] as FracRect);

/** A cols×rows grid placed inside the rectangle (x, y, w, h). */
const sub = (x: number, y: number, w: number, h: number, cols: number, rows: number): FracRect[] => grid(cols, rows).map(([gx, gy, gw, gh]) => [x + gx * w, y + gy * h, gw * w, gh * h] as FracRect);
/** Rows of photos: counts per row with optional relative heights. */
const rows = (counts: number[], heights: number[] = counts.map(() => 1)): FracRect[] => {
  const total = heights.reduce((a, b) => a + b, 0);
  let y = 0;
  return counts.flatMap((n, i) => {
    const h = heights[i] / total;
    const r = row(n, y, h);
    y += h;
    return r;
  });
};
/** Columns of photos: counts per column with optional relative widths. */
const cols = (counts: number[], widths: number[] = counts.map(() => 1)): FracRect[] => {
  const total = widths.reduce((a, b) => a + b, 0);
  let x = 0;
  return counts.flatMap((n, i) => {
    const w = widths[i] / total;
    const c = col(n, x, w);
    x += w;
    return c;
  });
};

export const LAYOUTS: Record<number, Layout[]> = {
  1: [{ id: '1', label: 'Single', cells: [[0, 0, 1, 1]] }],
  2: [
    { id: '2-cols', label: 'Side by side', cells: row(2, 0, 1) },
    { id: '2-rows', label: 'Stacked', cells: col(2, 0, 1) },
    { id: '2-big-left', label: 'Large + small', cells: [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
    { id: '2-big-top', label: 'Large top', cells: [[0, 0, 1, 2 / 3], [0, 2 / 3, 1, 1 / 3]] },
    { id: '2-big-right', label: 'Small + large', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 2 / 3, 1]] },
  ],
  3: [
    { id: '3-big-left', label: 'Large left', cells: [[0, 0, 0.6, 1], ...col(2, 0.6, 0.4)] },
    { id: '3-big-top', label: 'Large top', cells: [[0, 0, 1, 0.6], ...row(2, 0.6, 0.4)] },
    { id: '3-big-right', label: 'Large right', cells: [...col(2, 0, 0.4), [0.4, 0, 0.6, 1]] },
    { id: '3-big-bottom', label: 'Large bottom', cells: [...row(2, 0, 0.4), [0, 0.4, 1, 0.6]] },
    { id: '3-cols', label: 'Three columns', cells: row(3, 0, 1) },
    { id: '3-rows', label: 'Three rows', cells: col(3, 0, 1) },
    { id: '3-center', label: 'Wide center', cells: cols([1, 1, 1], [1, 2, 1]) },
    { id: '3-band', label: 'Center band', cells: rows([1, 1, 1], [1, 2, 1]) },
  ],
  4: [
    { id: '4-grid', label: 'Grid', cells: grid(2, 2) },
    { id: '4-big-left', label: 'Large left', cells: [[0, 0, 0.65, 1], ...col(3, 0.65, 0.35)] },
    { id: '4-big-top', label: 'Large top', cells: [[0, 0, 1, 0.62], ...row(3, 0.62, 0.38)] },
    { id: '4-big-right', label: 'Large right', cells: [...col(3, 0, 0.35), [0.35, 0, 0.65, 1]] },
    { id: '4-big-bottom', label: 'Large bottom', cells: [...row(3, 0, 0.38), [0, 0.38, 1, 0.62]] },
    { id: '4-steps', label: 'Staggered', cells: [[0, 0, 0.5, 0.6], [0.5, 0, 0.5, 0.4], [0, 0.6, 0.5, 0.4], [0.5, 0.4, 0.5, 0.6]] },
    { id: '4-center', label: 'Center focus', cells: rows([1, 2, 1], [1, 2, 1]) },
    { id: '4-cols', label: 'Four columns', cells: row(4, 0, 1) },
    { id: '4-rows', label: 'Four rows', cells: col(4, 0, 1) },
  ],
  5: [
    { id: '5-2-3', label: '2 over 3', cells: rows([2, 3], [0.55, 0.45]) },
    { id: '5-3-2', label: '3 over 2', cells: rows([3, 2], [0.45, 0.55]) },
    { id: '5-big-left', label: 'Large left', cells: [[0, 0, 0.5, 1], ...sub(0.5, 0, 0.5, 1, 2, 2)] },
    { id: '5-big-right', label: 'Large right', cells: [...sub(0, 0, 0.5, 1, 2, 2), [0.5, 0, 0.5, 1]] },
    { id: '5-big-top', label: 'Large top', cells: [[0, 0, 1, 0.58], ...row(4, 0.58, 0.42)] },
    { id: '5-mosaic', label: 'Mosaic', cells: [[0, 0, 0.6, 0.6], [0.6, 0, 0.4, 0.3], [0.6, 0.3, 0.4, 0.3], [0, 0.6, 0.3, 0.4], [0.3, 0.6, 0.7, 0.4]] },
    { id: '5-center', label: 'Center + 4', cells: cols([2, 1, 2], [1, 2, 1]) },
    { id: '5-cols', label: 'Five columns', cells: row(5, 0, 1) },
  ],
  6: [
    { id: '6-3x2', label: '3 × 2', cells: grid(3, 2) },
    { id: '6-2x3', label: '2 × 3', cells: grid(2, 3) },
    { id: '6-big', label: 'Large + 5', cells: [[0, 0, 2 / 3, 2 / 3], [2 / 3, 0, 1 / 3, 1 / 3], [2 / 3, 1 / 3, 1 / 3, 1 / 3], ...row(3, 2 / 3, 1 / 3)] },
    { id: '6-2-4', label: '2 over 4', cells: rows([2, 4], [0.6, 0.4]) },
    { id: '6-1-2-3', label: 'Pyramid', cells: rows([1, 2, 3], [0.4, 0.3, 0.3]) },
    { id: '6-center-col', label: 'Center column', cells: cols([2, 1, 3], [1, 2, 1]) },
    { id: '6-big-left', label: 'Large left', cells: [[0, 0, 0.5, 1], ...[...col(2, 0.5, 0.25), ...col(3, 0.75, 0.25)]] },
  ],
  7: [
    { id: '7-3-4', label: '3 over 4', cells: rows([3, 4]) },
    { id: '7-big-left', label: 'Large left', cells: [[0, 0, 0.5, 1], ...sub(0.5, 0, 0.5, 1, 2, 3)] },
    { id: '7-big-top', label: 'Large top', cells: [[0, 0, 1, 0.5], ...sub(0, 0.5, 1, 0.5, 3, 2)] },
    { id: '7-2-3-2', label: '2 · 3 · 2', cells: rows([2, 3, 2]) },
    { id: '7-center', label: 'Center + 6', cells: cols([3, 1, 3], [1, 2, 1]) },
  ],
  8: [
    { id: '8-4x2', label: '4 × 2', cells: grid(4, 2) },
    { id: '8-2x4', label: '2 × 4', cells: grid(2, 4) },
    { id: '8-big', label: 'Large + 7', cells: [[0, 0, 0.5, 0.5], ...sub(0.5, 0, 0.5, 0.5, 2, 2), ...row(3, 0.5, 0.5)] },
    { id: '8-3-2-3', label: '3 · 2 · 3', cells: rows([3, 2, 3]) },
    { id: '8-center', label: 'Center + 7', cells: [...row(3, 0, 0.25), [0, 0.25, 0.25, 0.5], [0.25, 0.25, 0.5, 0.5], [0.75, 0.25, 0.25, 0.5], ...row(2, 0.75, 0.25)] },
  ],
  9: [
    { id: '9-3x3', label: '3 × 3', cells: grid(3, 3) },
    { id: '9-big', label: 'Large + 8', cells: [[0, 0, 0.5, 0.5], ...sub(0.5, 0, 0.5, 0.5, 2, 2), ...row(4, 0.5, 0.5)] },
    { id: '9-center', label: 'Center + 8', cells: [...row(3, 0, 0.25), [0, 0.25, 0.25, 0.5], [0.25, 0.25, 0.5, 0.5], [0.75, 0.25, 0.25, 0.5], ...row(3, 0.75, 0.25)] },
    { id: '9-4-1-4', label: 'Banner', cells: rows([4, 1, 4], [1, 1.2, 1]) },
    { id: '9-2-3-4', label: '2 · 3 · 4', cells: rows([2, 3, 4]) },
  ],
  10: [
    { id: '10-5x2', label: '5 × 2', cells: grid(5, 2) },
    { id: '10-2-4-4', label: '2 · 4 · 4', cells: rows([2, 4, 4], [1.4, 1, 1]) },
    { id: '10-big', label: 'Large + 9', cells: [[0, 0, 0.5, 0.5], ...sub(0.5, 0, 0.5, 0.5, 2, 2), ...row(5, 0.5, 0.5)] },
  ],
  11: [
    { id: '11-3-4-4', label: '3 · 4 · 4', cells: rows([3, 4, 4]) },
    { id: '11-center', label: 'Center + 10', cells: [...row(4, 0, 0.25), [0, 0.25, 0.25, 0.5], [0.25, 0.25, 0.5, 0.5], [0.75, 0.25, 0.25, 0.5], ...row(4, 0.75, 0.25)] },
  ],
  12: [
    { id: '12-4x3', label: '4 × 3', cells: grid(4, 3) },
    { id: '12-3x4', label: '3 × 4', cells: grid(3, 4) },
    { id: '12-big', label: 'Large + 11', cells: [[0, 0, 0.5, 0.5], ...sub(0.5, 0, 0.5, 0.5, 3, 1), ...sub(0, 0.5, 1, 0.5, 4, 2)] },
  ],
};

/** Most photos a collage can hold (the engine accepts up to 16). */
export const MAX_COLLAGE_PHOTOS = 12;

export function layoutsFor(count: number): Layout[] {
  return LAYOUTS[Math.max(1, Math.min(MAX_COLLAGE_PHOTOS, count))] ?? [];
}

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Convert fractional cells to whole pixels. `margin` is the outer border and
 * `gap` the spacing between photos; interior edges are inset by gap/2 so every
 * gap is exactly `gap` pixels wide.
 */
export function cellRects(cells: FracRect[], width: number, height: number, margin: number, gap: number): PxRect[] {
  const innerW = width - 2 * margin;
  const innerH = height - 2 * margin;
  const eps = 1e-6;
  return cells.map(([fx, fy, fw, fh]) => {
    let x0 = margin + fx * innerW;
    let y0 = margin + fy * innerH;
    let x1 = margin + (fx + fw) * innerW;
    let y1 = margin + (fy + fh) * innerH;
    if (fx > eps) x0 += gap / 2;
    if (fy > eps) y0 += gap / 2;
    if (fx + fw < 1 - eps) x1 -= gap / 2;
    if (fy + fh < 1 - eps) y1 -= gap / 2;
    const x = Math.round(x0);
    const y = Math.round(y0);
    return { x, y, w: Math.max(1, Math.round(x1) - x), h: Math.max(1, Math.round(y1) - y) };
  });
}

/** Same maths as `collage::framing` in Rust (CSS object-position semantics). */
export function framing(cellW: number, cellH: number, imgW: number, imgH: number, fit: 'cover' | 'contain', zoom: number, fx: number, fy: number) {
  const base = fit === 'cover' ? Math.max(cellW / imgW, cellH / imgH) : Math.min(cellW / imgW, cellH / imgH);
  const scale = base * Math.min(8, Math.max(1, zoom));
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { scale, drawW, drawH, offsetX: (cellW - drawW) * c(fx), offsetY: (cellH - drawH) * c(fy) };
}

export const CANVAS_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'square', label: 'Square 1080 × 1080', w: 1080, h: 1080 },
  { id: 'portrait', label: 'Portrait 4:5 · 1080 × 1350', w: 1080, h: 1350 },
  { id: 'story', label: 'Story 9:16 · 1080 × 1920', w: 1080, h: 1920 },
  { id: 'landscape', label: 'Landscape 16:9 · 1920 × 1080', w: 1920, h: 1080 },
  { id: 'facebook', label: 'Facebook post 1200 × 630', w: 1200, h: 630 },
  { id: 'a4', label: 'A4 print 2480 × 3508', w: 2480, h: 3508 },
];
