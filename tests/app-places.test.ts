import { describe, expect, it } from 'vitest';
import { coordsText, distanceM, formatDistance } from '../src/app/places';

describe('places helpers', () => {
  it('distanceM matches the Rust haversine', () => {
    expect(distanceM(23.8103, 90.4125, 21.4225, 39.8262) / 1000).toBeCloseTo(5172, -1);
    expect(distanceM(23.0, 90.0, 23.0045, 90.0)).toBeGreaterThan(495);
    expect(distanceM(23.0, 90.0, 23.0045, 90.0)).toBeLessThan(505);
    expect(distanceM(1, 2, 1, 2)).toBe(0);
  });
  it('formats distances', () => {
    expect(formatDistance(42)).toBe('40 m');
    expect(formatDistance(334)).toBe('330 m');
    expect(formatDistance(1450)).toBe('1.4 km');
    expect(formatDistance(23_400)).toBe('23 km');
  });
  it('coordsText', () => {
    expect(coordsText({ latitude: 23.729812, longitude: 90.41194 })).toBe('23.72981, 90.41194');
  });
});
