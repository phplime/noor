import { describe, expect, it } from 'vitest';
import {
  addDays,
  describeOffset,
  findNext,
  formatCountdown,
  formatDateLabel,
  formatShort,
  formatTime,
  localDate,
  reminderSummary,
  shortOffset,
} from '../src/island/lib/time';
import type { DailyPrayerSchedule } from '../src/island/lib/types';

const schedule = (date: string, times: Record<string, string>): DailyPrayerSchedule => ({
  date,
  locationId: 'x',
  locationName: 'Dhaka',
  timezone: 'Asia/Dhaka',
  method: 'karachi',
  asr: 'hanafi',
  entries: Object.entries(times).map(([prayer, time]) => ({
    prayer: prayer as DailyPrayerSchedule['entries'][number]['prayer'],
    time,
    calculatedTime: time,
    offsetMinutes: 0,
    source: 'calculated',
    highLatitudeAdjusted: false,
  })),
});

describe('time helpers', () => {
  it('formats countdowns and short durations', () => {
    expect(formatCountdown(42 * 60 + 18)).toBe('00:42:18');
    expect(formatCountdown(-5)).toBe('00:00:00');
    expect(formatShort(45)).toBe('45s');
    expect(formatShort(12 * 60)).toBe('12m');
    expect(formatShort(2 * 3600 + 5 * 60)).toBe('2h 05m');
  });

  it('describes reminder offsets clearly', () => {
    expect(describeOffset(-15)).toBe('15 min before');
    expect(describeOffset(0)).toBe('At prayer time');
    expect(describeOffset(5)).toBe('5 min after');
    expect(shortOffset(-10)).toBe('−10m');
    expect(
      reminderSummary({
        prayer: 'asr',
        enabled: true,
        reminders: [
          { id: 'b', prayer: 'asr', offsetMinutes: 0, enabled: true, title: null, message: null, sound: null },
          { id: 'a', prayer: 'asr', offsetMinutes: -20, enabled: true, title: null, message: null, sound: null },
          { id: 'c', prayer: 'asr', offsetMinutes: -5, enabled: false, title: null, message: null, sound: null },
        ],
      }),
    ).toBe('20 min before · At prayer time');
  });

  it('formats in the location time zone', () => {
    expect(formatTime('2026-10-31T09:44:00Z', 'Asia/Dhaka', false)).toBe('3:44 PM');
    expect(formatTime('2026-10-31T09:44:00Z', 'Asia/Dhaka', true)).toBe('15:44');
    expect(localDate(Date.parse('2026-10-31T19:00:00Z'), 'Asia/Dhaka')).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatDateLabel('2026-10-31')).toBe('Sat 31 Oct');
  });

  it('finds the next prayer, skipping sunrise and rolling to tomorrow', () => {
    const today = schedule('2026-10-31', {
      fajr: '2026-10-30T22:47:00Z',
      sunrise: '2026-10-31T00:04:00Z',
      dhuhr: '2026-10-31T05:42:00Z',
      isha: '2026-10-31T12:37:00Z',
    });
    const tomorrow = schedule('2026-11-01', { fajr: '2026-10-31T22:48:00Z' });
    const n1 = findNext([today, tomorrow], Date.parse('2026-10-30T23:30:00Z'));
    expect(n1?.entry.prayer).toBe('dhuhr');
    const n2 = findNext([today, tomorrow], Date.parse('2026-10-30T23:30:00Z'), true);
    expect(n2?.entry.prayer).toBe('sunrise');
    const n3 = findNext([today, tomorrow], Date.parse('2026-10-31T15:00:00Z'));
    expect(n3?.date).toBe('2026-11-01');
    expect(findNext([today], Date.parse('2026-11-02T00:00:00Z'))).toBeNull();
  });
});
