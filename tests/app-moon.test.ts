import { describe, expect, it } from 'vitest';
import { moonPhase } from '../src/app/moon';

// Reference phases (UTC) from published almanac tables.
describe('moonPhase', () => {
  it('is near new at a known new moon', () => {
    const p = moonPhase(new Date(Date.UTC(2024, 3, 8, 18, 21)));
    expect(p.illumination).toBeLessThan(0.01);
  });
  it('is near full at a known full moon', () => {
    const p = moonPhase(new Date(Date.UTC(2024, 8, 18, 2, 34)));
    expect(p.illumination).toBeGreaterThan(0.99);
    expect(p.key).toBe('full');
  });
  it('is about half at a known first quarter', () => {
    const p = moonPhase(new Date(Date.UTC(2025, 0, 6, 23, 56)));
    expect(p.illumination).toBeGreaterThan(0.45);
    expect(p.illumination).toBeLessThan(0.55);
    expect(p.key).toBe('first-quarter');
    expect(p.waxing).toBe(true);
  });
  it('is waning at a known last quarter', () => {
    const p = moonPhase(new Date(Date.UTC(2025, 0, 21, 20, 31)));
    expect(p.key).toBe('last-quarter');
    expect(p.waxing).toBe(false);
  });
});
