import type { PrayerTimeEntry } from '../island/lib/types';

/** The three times of day when salah is not offered (makruh / nisiddho). */
export interface MakruhWindow {
  key: 'sunrise' | 'zawal' | 'sunset';
  en: string;
  bn: string;
  start: number;
  end: number;
}

const MIN = 60_000;

/**
 * From a day's entries. Uses the calculated (astronomical) times, so a fixed
 * mosque time for Dhuhr or Maghrib doesn't move the forbidden windows.
 *  - sunrise: from sunrise until ~15 min after (sun fully up)
 *  - zawal: ~10 min before Dhuhr begins (sun at its zenith)
 *  - sunset: ~15 min before sunset (sun turning yellow)
 */
export function makruhWindows(entries: PrayerTimeEntry[]): MakruhWindow[] {
  const calc = (p: string) => {
    const e = entries.find((x) => x.prayer === p);
    return e ? Date.parse(e.calculatedTime ?? e.time) : NaN;
  };
  const sunrise = calc('sunrise');
  const dhuhr = calc('dhuhr');
  const maghrib = calc('maghrib');
  const out: MakruhWindow[] = [];
  if (!Number.isNaN(sunrise)) out.push({ key: 'sunrise', en: 'Sunrise', bn: 'সূর্যোদয়', start: sunrise, end: sunrise + 15 * MIN });
  if (!Number.isNaN(dhuhr)) out.push({ key: 'zawal', en: 'Zawal (midday)', bn: 'দ্বিপ্রহর', start: dhuhr - 10 * MIN, end: dhuhr });
  if (!Number.isNaN(maghrib)) out.push({ key: 'sunset', en: 'Before sunset', bn: 'সূর্যাস্তের আগে', start: maghrib - 15 * MIN, end: maghrib });
  return out;
}

export const activeMakruh = (list: MakruhWindow[], now: number) => list.find((w) => now >= w.start && now < w.end) ?? null;
