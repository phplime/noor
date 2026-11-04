import { describe, expect, it } from 'vitest';
import { cellRects, framing, LAYOUTS, layoutsFor } from '../src/kit/tools/collage/layouts';

describe('collage layouts', () => {
  it('every layout has the right number of cells, all inside the unit square without overlap', () => {
    for (const [n, layouts] of Object.entries(LAYOUTS)) {
      for (const l of layouts) {
        expect(l.cells.length, l.id).toBe(Number(n));
        let area = 0;
        for (const [x, y, w, h] of l.cells) {
          expect(x).toBeGreaterThanOrEqual(-1e-9);
          expect(y).toBeGreaterThanOrEqual(-1e-9);
          expect(x + w).toBeLessThanOrEqual(1 + 1e-9);
          expect(y + h).toBeLessThanOrEqual(1 + 1e-9);
          area += w * h;
        }
        expect(area, `${l.id} covers the whole area`).toBeCloseTo(1, 6);
        for (const a of l.cells)
          for (const b of l.cells) {
            if (a === b) continue;
            const ov = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
            expect(ov, `${l.id} cells overlap`).toBeLessThan(1e-9);
          }
      }
    }
    expect(layoutsFor(20).length).toBeGreaterThan(0);
  });

  it('offers a choice of layouts for every photo count, with unique ids', () => {
    const ids = Object.values(LAYOUTS).flat().map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let n = 2; n <= 12; n++) expect(layoutsFor(n).length, `${n} photos`).toBeGreaterThanOrEqual(2);
    for (let n = 2; n <= 9; n++) expect(layoutsFor(n).length, `${n} photos`).toBeGreaterThanOrEqual(5);
  });

  it('gaps and margins are exact pixels', () => {
    const r = cellRects(LAYOUTS[2][0].cells, 1000, 600, 20, 10);
    expect(r[0]).toEqual({ x: 20, y: 20, w: 475, h: 560 });
    expect(r[1].x - (r[0].x + r[0].w)).toBe(10);
    expect(r[1].x + r[1].w).toBe(980);
  });

  it('framing matches the Rust engine', () => {
    expect(framing(100, 100, 400, 200, 'cover', 1, 0.5, 0.5)).toMatchObject({ drawW: 200, drawH: 100, offsetX: -50, offsetY: 0 });
    expect(framing(100, 100, 400, 200, 'contain', 1, 0.5, 0.5)).toMatchObject({ drawW: 100, drawH: 50, offsetY: 25 });
    expect(framing(100, 100, 100, 100, 'cover', 2, 0.5, 0.5)).toMatchObject({ drawW: 200, offsetX: -50 });
  });
});
