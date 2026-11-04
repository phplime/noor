import { describe, expect, it } from 'vitest';
import { banglaFor, builtin, dateForHijri, hijriFor, hijriToJdn, jdnToHijri, jdnOf, monthDays, upcoming } from '../src/dev/mockcal';
import { banglaLong, hijriAr, toAr, toBn } from '../src/app/calendar';

const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 86_400_000;

describe('preview calendar twin (must agree with the Rust calendar)', () => {
  it('Bangla (Bangladesh revised calendar)', () => {
    expect(banglaFor('2026-04-14')).toEqual({ year: 1433, month: 1, day: 1 });
    expect(banglaFor('2026-02-21')).toEqual({ year: 1432, month: 11, day: 8 });
    expect(banglaFor('2027-03-26')).toEqual({ year: 1433, month: 12, day: 12 });
    expect(banglaFor('2026-12-16')).toEqual({ year: 1433, month: 9, day: 1 });
    expect(banglaFor('2026-11-01')).toEqual({ year: 1433, month: 7, day: 16 });
    expect(banglaFor('2028-04-13')).toEqual({ year: 1434, month: 12, day: 30 });
    expect(banglaFor('2028-02-21')).toEqual({ year: 1434, month: 11, day: 8 });
  });

  it('Hijri round trips and known dates', () => {
    for (let j = 2_440_000; j < 2_520_000; j += 37) {
      const h = jdnToHijri(j);
      expect(hijriToJdn(h.year, h.month, h.day)).toBe(j);
    }
    expect(near(dateForHijri(1447, 9, 1, 0), '2026-02-18')).toBe(true);
    expect(near(dateForHijri(1447, 10, 1, 0), '2026-03-20')).toBe(true);
    expect(hijriFor('2000-01-01', 0).month).toBe(9);
    expect(jdnOf(2000, 1, 1)).toBe(2_451_545);
  });

  it('occasions and month grid', () => {
    expect(builtin('2026-12-16', 0, true).map((o) => o.key)).toEqual(['victory']);
    expect(builtin('2026-11-01', 0, true)).toEqual([]);
    const nov = monthDays(2026, 11, 0, true, []);
    expect(nov).toHaveLength(30);
    expect(nov[0].weekday).toBe(0);
    expect(upcoming('2026-12-01', 30, 0, true, false, []).some((x) => x.occasion.key === 'victory')).toBe(true);
  });

  it('numerals and labels', () => {
    expect(toBn(2026)).toBe('২০২৬');
    expect(toAr(1448)).toBe('١٤٤٨');
    expect(banglaLong({ year: 1433, month: 7, day: 16 })).toBe('১৬ কার্তিক ১৪৩৩');
    expect(hijriAr({ year: 1448, month: 9, day: 1 })).toBe('١ رمضان ١٤٤٨');
  });
});
