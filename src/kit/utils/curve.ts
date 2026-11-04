import type { CurvePoints } from '../types/engine';

export const LINEAR: CurvePoints = [
  [0, 0],
  [1, 1],
];

export function isIdentityCurve(c: CurvePoints): boolean {
  return c.length < 2 || c.every(([x, y]) => Math.abs(x - y) < 1e-6);
}

/**
 * Monotone cubic (Fritsch–Carlson) interpolation — the same algorithm the Rust
 * engine uses, so the drawn curve matches the exported result.
 */
export function makeCurve(points: CurvePoints): (x: number) => number {
  const pts = [...points].sort((a, b) => a[0] - b[0]).filter((p, i, arr) => i === 0 || p[0] - arr[i - 1][0] > 1e-9);
  if (pts.length < 2) return (x) => x;
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] < 1) pts.push([1, pts[pts.length - 1][1]]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }
  return (x: number) => {
    const cx = Math.min(1, Math.max(0, x));
    let seg = 0;
    while (seg < n - 2 && cx > xs[seg + 1]) seg++;
    const h = xs[seg + 1] - xs[seg];
    const t = Math.min(1, Math.max(0, (cx - xs[seg]) / h));
    const t2 = t * t;
    const t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h * m[seg + 1];
    return Math.min(1, Math.max(0, y));
  };
}

export const CURVE_PRESETS: { id: string; label: string; points: CurvePoints }[] = [
  { id: 'linear', label: 'Linear', points: LINEAR },
  { id: 'soft', label: 'Soft contrast', points: [[0, 0], [0.25, 0.21], [0.75, 0.79], [1, 1]] },
  { id: 'strong', label: 'Strong contrast', points: [[0, 0], [0.25, 0.16], [0.75, 0.85], [1, 1]] },
  { id: 'brighten', label: 'Brighten', points: [[0, 0], [0.5, 0.6], [1, 1]] },
  { id: 'darken', label: 'Darken', points: [[0, 0], [0.5, 0.4], [1, 1]] },
  { id: 'fade', label: 'Faded film', points: [[0, 0.08], [0.5, 0.5], [1, 0.95]] },
];

/** Insert a point keeping x order; returns the new array and the inserted index. */
export function insertPoint(points: CurvePoints, p: [number, number]): { points: CurvePoints; index: number } {
  const next = [...points, p].sort((a, b) => a[0] - b[0]);
  return { points: next, index: next.indexOf(p) };
}

/** Move point i; end points keep their x, inner points stay between neighbours. */
export function movePoint(points: CurvePoints, i: number, x: number, y: number): CurvePoints {
  const next = points.map((p) => [...p] as [number, number]);
  const last = next.length - 1;
  const cy = Math.min(1, Math.max(0, y));
  if (i === 0 || i === last) {
    next[i] = [next[i][0], cy];
  } else {
    const lo = next[i - 1][0] + 0.01;
    const hi = next[i + 1][0] - 0.01;
    next[i] = [Math.min(hi, Math.max(lo, x)), cy];
  }
  return next;
}
