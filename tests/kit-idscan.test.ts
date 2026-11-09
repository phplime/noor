import { describe, expect, it } from 'vitest';
import { PAGE_H, PAGE_W, placeParts } from '../src/kit/tools/id-scan/layout';

const card = { width: 1600, height: 1009 }; // ID-1 aspect

describe('placeParts', () => {
  it('centres front above back with the gap, at true NID size', () => {
    const [a, b] = placeParts([card, card], 'nid', 20);
    expect(a.w).toBe(1011); // 85.6 mm at 300 dpi
    expect(a.x).toBe(Math.round((PAGE_W - a.w) / 2));
    expect(b.x).toBe(a.x);
    expect(b.y - (a.y + a.h)).toBe(Math.round((20 * PAGE_W) / 794));
    const top = a.y;
    const bottom = PAGE_H - (b.y + b.h);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
  });

  it('centres a single side', () => {
    const [a] = placeParts([card], 'passport', 20);
    expect(Math.abs(a.y - (PAGE_H - a.y - a.h))).toBeLessThanOrEqual(1);
  });

  it('shrinks parts that would not fit the page', () => {
    const tall = { width: 1000, height: 3000 };
    const r = placeParts([tall, tall], 'large', 20);
    expect(r[1].y + r[1].h).toBeLessThan(PAGE_H);
    expect(r[0].y).toBeGreaterThan(0);
  });
});
