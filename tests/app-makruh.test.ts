import { describe, expect, it } from 'vitest';
import { activeMakruh, makruhWindows } from '../src/app/makruh';

const e = (prayer: string, iso: string, calc?: string) => ({ prayer, time: iso, calculatedTime: calc ?? iso, offsetMinutes: 0, source: 'calculated', highLatitudeAdjusted: false }) as never;

describe('makruhWindows', () => {
  const entries = [e('fajr', '2026-11-03T04:56:00+06:00'), e('sunrise', '2026-11-03T06:09:00+06:00'), e('dhuhr', '2026-11-03T13:15:00+06:00', '2026-11-03T11:48:00+06:00'), e('maghrib', '2026-11-03T17:22:00+06:00')];
  const list = makruhWindows(entries);
  it('builds three windows from calculated times', () => {
    expect(list.map((w) => w.key)).toEqual(['sunrise', 'zawal', 'sunset']);
    expect(new Date(list[1].start).toISOString()).toBe('2026-11-03T05:38:00.000Z'); // 11:38 Dhaka, not the fixed 1:15 PM
  });
  it('finds the active one', () => {
    expect(activeMakruh(list, Date.parse('2026-11-03T06:15:00+06:00'))?.key).toBe('sunrise');
    expect(activeMakruh(list, Date.parse('2026-11-03T17:10:00+06:00'))?.key).toBe('sunset');
    expect(activeMakruh(list, Date.parse('2026-11-03T09:00:00+06:00'))).toBeNull();
  });
});
