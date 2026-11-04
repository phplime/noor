import type { DailyPrayerSchedule, Prayer } from '../island/lib/types';
import { PRAYER_NAMES } from '../island/lib/types';

const HOUR = 3_600_000;

export const PERIOD_BN: Record<string, string> = {
  fajr: 'ফজর',
  ishraq: 'ইশরাক / চাশত',
  dhuhr: 'যোহর',
  jumuah: 'জুমা',
  asr: 'আসর',
  maghrib: 'মাগরিব',
  isha: 'এশা',
};

export interface Period {
  key: string;
  en: string;
  start: number;
  end: number;
}

export interface DayTimes {
  fajr: number;
  sunrise: number;
  dhuhr: number;
  asr: number;
  maghrib: number;
  isha: number;
  nextFajr: number;
}

export function dayTimes(days: DailyPrayerSchedule[]): DayTimes | null {
  const at = (d: DailyPrayerSchedule | undefined, p: Prayer) => {
    const e = d?.entries.find((x) => x.prayer === p);
    return e ? Date.parse(e.time) : NaN;
  };
  const today = days[0];
  if (!today) return null;
  const t = {
    fajr: at(today, 'fajr'),
    sunrise: at(today, 'sunrise'),
    dhuhr: at(today, 'dhuhr'),
    asr: at(today, 'asr'),
    maghrib: at(today, 'maghrib'),
    isha: at(today, 'isha'),
    nextFajr: at(days[1], 'fajr'),
  };
  if ([t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha].some(Number.isNaN)) return null;
  if (Number.isNaN(t.nextFajr)) t.nextFajr = t.fajr + 24 * HOUR;
  return t;
}

/** The day split into prayer periods (Isha runs to the next Fajr; Ishraq from sunrise to Dhuhr). */
export function periods(t: DayTimes, now: number): Period[] {
  const friday = new Date(now).getDay() === 5;
  return [
    { key: 'isha', en: 'Isha', start: t.isha - 24 * HOUR, end: t.fajr },
    { key: 'fajr', en: 'Fajr', start: t.fajr, end: t.sunrise },
    { key: 'ishraq', en: 'Ishraq', start: t.sunrise, end: t.dhuhr },
    { key: friday ? 'jumuah' : 'dhuhr', en: friday ? "Jumu'ah" : 'Dhuhr', start: t.dhuhr, end: t.asr },
    { key: 'asr', en: 'Asr', start: t.asr, end: t.maghrib },
    { key: 'maghrib', en: 'Maghrib', start: t.maghrib, end: t.isha },
    { key: 'isha', en: 'Isha', start: t.isha, end: t.nextFajr },
  ];
}

export function currentPeriod(t: DayTimes, now: number): Period {
  const list = periods(t, now);
  return list.find((p) => now >= p.start && now < p.end) ?? list[list.length - 1];
}

/** The next actual prayer (not sunrise) after `now`. */
export function nextPrayer(days: DailyPrayerSchedule[], now: number) {
  return days.flatMap((d) => d.entries).find((e) => e.prayer !== 'sunrise' && Date.parse(e.time) > now) ?? null;
}

export const prayerName = (p: Prayer) => PRAYER_NAMES[p];

export interface NightWindow {
  /** Islamic midnight: halfway between Maghrib and Fajr. */
  midnight: number;
  /** Start of the last third of the night — the best time for Tahajjud. */
  start: number;
  /** Tahajjud ends when Fajr begins. */
  end: number;
}

/**
 * Tahajjud window for the night that `now` belongs to.
 * The night runs from Maghrib to the next Fajr; Tahajjud is best in its last third.
 * Before Fajr we're still in last night (yesterday's Maghrib to today's Fajr).
 */
export function tahajjud(t: DayTimes, now: number): NightWindow {
  const [dusk, dawn] = now < t.fajr ? [t.maghrib - 24 * HOUR, t.fajr] : [t.maghrib, t.nextFajr];
  const night = dawn - dusk;
  return { midnight: dusk + night / 2, start: dusk + (night * 2) / 3, end: dawn };
}
