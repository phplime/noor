import { describe, expect, it } from 'vitest';
import { livePayload } from '../src/app/live';

const e = (prayer: string, iso: string) => ({ prayer, time: iso, calculatedTime: iso, offsetMinutes: 0, source: 'calculated', highLatitudeAdjusted: false });
const day = (date: string) => ({
  date,
  entries: [
    e('fajr', `${date}T04:56:00+06:00`),
    e('sunrise', `${date}T06:09:00+06:00`),
    e('dhuhr', `${date}T11:48:00+06:00`),
    e('asr', `${date}T15:41:00+06:00`),
    e('maghrib', `${date}T17:22:00+06:00`),
    e('isha', `${date}T18:39:00+06:00`),
  ],
});
const snap = { today: day('2026-11-03'), tomorrow: day('2026-11-04'), activeLocation: { name: 'Dhaka' } } as never;

describe('livePayload', () => {
  it('describes the current period and the next prayer', () => {
    const p = livePayload(snap, Date.parse('2026-11-03T16:20:00+06:00'))!;
    expect(p.current).toBe('Asr');
    expect(p.currentBn).toBe('আসর');
    expect(p.periodEnd).toBe(Date.parse('2026-11-03T17:22:00+06:00'));
    expect(p.next).toBe('Maghrib');
    expect(p.slots.map((s) => s.name)).toEqual(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
    expect(p.makruhUntil).toBeNull();
  });
  it('flags makruh time and shows tomorrow after Isha', () => {
    expect(livePayload(snap, Date.parse('2026-11-03T17:12:00+06:00'))!.makruhUntil).toBe(Date.parse('2026-11-03T17:22:00+06:00'));
    const late = livePayload(snap, Date.parse('2026-11-03T21:00:00+06:00'))!;
    expect(late.current).toBe('Isha');
    expect(late.next).toBe('Fajr');
    expect(late.slots[0].at).toBe(Date.parse('2026-11-04T04:56:00+06:00'));
  });
});
