import { describe, expect, it } from 'vitest';
import { insertPoint, isIdentityCurve, makeCurve, movePoint, LINEAR, CURVE_PRESETS } from '../src/kit/utils/curve';
import { placementForPosition, clampToArea } from '../src/kit/tools/watermark/DragOverlay';
import { isNeutral, DEFAULT_ADJUST, ADJUST_PRESETS } from '../src/kit/tools/adjust/presets';

describe('tone curve', () => {
  it('linear is identity', () => {
    const f = makeCurve(LINEAR);
    for (const x of [0, 0.1, 0.5, 0.9, 1]) expect(f(x)).toBeCloseTo(x, 6);
    expect(isIdentityCurve(LINEAR)).toBe(true);
  });
  it('passes through points and stays monotone (matches the Rust engine)', () => {
    const s = CURVE_PRESETS.find((c) => c.id === 'strong')!.points;
    const f = makeCurve(s);
    expect(f(0.25)).toBeCloseTo(0.16, 3);
    expect(f(0.75)).toBeCloseTo(0.85, 3);
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const y = f(i / 200);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });
  it('edits points safely', () => {
    const { points, index } = insertPoint(LINEAR, [0.4, 0.6]);
    expect(index).toBe(1);
    const moved = movePoint(points, 1, 5, -2);
    expect(moved[1][0]).toBeLessThan(1);
    expect(moved[1][1]).toBe(0);
    const end = movePoint(points, 0, 0.5, 0.2);
    expect(end[0]).toEqual([0, 0.2]);
  });
});

describe('watermark drag positioning', () => {
  const layout = { rect: { x: 760, y: 460, w: 200, h: 100 }, area: { x: 20, y: 20, w: 960, h: 560 } };
  it('converts a dragged position to custom fractions', () => {
    const p = placementForPosition(layout, 300, 150);
    expect(p.anchor).toBe('custom');
    expect(p.x).toBeCloseTo((300 - 20) / 760);
    expect(p.y).toBeCloseTo((150 - 20) / 460);
  });
  it('keeps the watermark inside the margins', () => {
    expect(clampToArea(layout, -500, 5000)).toEqual({ x: 20, y: 480 });
  });
});

describe('adjust presets', () => {
  it('default is neutral and every preset except Original changes something', () => {
    expect(isNeutral(DEFAULT_ADJUST)).toBe(true);
    for (const p of ADJUST_PRESETS) {
      const spec = { ...DEFAULT_ADJUST, ...p.spec, curves: { ...DEFAULT_ADJUST.curves, ...(p.spec.curves ?? {}) } };
      expect(isNeutral(spec)).toBe(p.id === 'original');
    }
  });
});
