import { describe, expect, it } from 'vitest';
import { applyRatio, clampRect, dragRect, maxRectForRatio, parseRatio, toCropSpec, type Rect } from '../src/kit/utils/cropMath';

const B = { w: 1200, h: 800 };
const inside = (r: Rect, b = B) => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= b.w + 1e-9 && r.y + r.h <= b.h + 1e-9;

describe('parseRatio', () => {
  it('accepts custom ratios from the spec', () => {
    expect(parseRatio('590:300')).toEqual({ w: 590, h: 300 });
    expect(parseRatio('80:80')).toEqual({ w: 80, h: 80 });
    expect(parseRatio('1200:628')).toEqual({ w: 1200, h: 628 });
    expect(parseRatio('1920x1080')).toEqual({ w: 1920, h: 1080 });
    expect(parseRatio(' 1.91 / 1 ')).toEqual({ w: 1.91, h: 1 });
  });
  it('rejects invalid ratios', () => {
    for (const s of ['0:1', '1:0', '-1:2', 'abc', '16:', '', '1:2:3']) expect(parseRatio(s)).toBeNull();
  });
});

describe('maxRectForRatio', () => {
  it('centres the largest rect of the ratio', () => {
    expect(maxRectForRatio(B, 1)).toEqual({ x: 200, y: 0, w: 800, h: 800 });
    const r = maxRectForRatio(B, 590 / 300);
    expect(r.w).toBe(1200);
    expect(r.h).toBeCloseTo(610.17, 1);
    expect(inside(r)).toBe(true);
    expect(maxRectForRatio(B, null)).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
    const portrait = maxRectForRatio(B, 9 / 16);
    expect(portrait.h).toBe(800);
    expect(portrait.w).toBeCloseTo(450);
  });
});

describe('dragRect', () => {
  const start: Rect = { x: 100, y: 100, w: 400, h: 300 };

  it('moves within bounds', () => {
    expect(dragRect(start, 'move', 50, -20, null, B)).toEqual({ x: 150, y: 80, w: 400, h: 300 });
    expect(dragRect(start, 'move', 5000, 5000, null, B)).toEqual({ x: 800, y: 500, w: 400, h: 300 });
    expect(dragRect(start, 'move', -5000, -5000, null, B)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('resizes freeform edges and corners', () => {
    expect(dragRect(start, 'e', 100, 0, null, B)).toEqual({ x: 100, y: 100, w: 500, h: 300 });
    expect(dragRect(start, 'nw', -50, -50, null, B)).toEqual({ x: 50, y: 50, w: 450, h: 350 });
    // cannot invert or go out of bounds
    const r = dragRect(start, 'w', 1000, 0, null, B);
    expect(r.w).toBeGreaterThanOrEqual(8);
    expect(inside(dragRect(start, 'se', 5000, 5000, null, B))).toBe(true);
  });

  it('keeps a locked ratio for every handle and stays in bounds', () => {
    const ratio = 16 / 9;
    const locked = applyRatio(start, ratio, B);
    for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      for (const [dx, dy] of [
        [40, 25],
        [-60, -10],
        [3000, 3000],
        [-3000, -3000],
      ]) {
        const r = dragRect(locked, h, dx, dy, ratio, B);
        expect(r.w / r.h).toBeCloseTo(ratio, 5);
        expect(inside(r)).toBe(true);
        expect(r.w).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the opposite corner fixed', () => {
    const r = dragRect(start, 'se', 100, 0, 4 / 3, B);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
    const r2 = dragRect(start, 'nw', -100, 0, 4 / 3, B);
    expect(r2.x + r2.w).toBeCloseTo(500);
    expect(r2.y + r2.h).toBeCloseTo(400);
  });
});

describe('applyRatio / clampRect / toCropSpec', () => {
  it('reshapes around the centre inside bounds', () => {
    const r = applyRatio({ x: 1000, y: 700, w: 200, h: 100 }, 1, B);
    expect(r.w).toBeCloseTo(r.h);
    expect(inside(r)).toBe(true);
  });
  it('clamps', () => {
    expect(clampRect({ x: -10, y: 900, w: 5000, h: 50 }, B)).toEqual({ x: 0, y: 750, w: 1200, h: 50 });
  });
  it('produces valid integer crop specs', () => {
    expect(toCropSpec({ x: 0.4, y: 0.6, w: 1199.7, h: 799.9 }, B)).toEqual({ x: 0, y: 1, width: 1200, height: 799 });
    const c = toCropSpec({ x: 1199.9, y: 799.9, w: 0.1, h: 0.1 }, B);
    expect(c.width).toBeGreaterThanOrEqual(1);
    expect(c.x + c.width).toBeLessThanOrEqual(1200);
  });
});
