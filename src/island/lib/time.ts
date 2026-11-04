import type { DailyPrayerSchedule, Prayer, PrayerNotificationConfig, PrayerTimeEntry } from './types';

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = fmtCache.get(key);
  if (!f) {
    f = make();
    fmtCache.set(key, f);
  }
  return f;
}

/** Wall-clock time at the prayer location. */
export function formatTime(iso: string | number | Date, timeZone: string, use24Hour: boolean): string {
  const f = formatter(`t|${timeZone}|${use24Hour}`, () =>
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: !use24Hour, timeZone }),
  );
  return f.format(new Date(iso));
}

/** "Sat, 31 Oct" for a plain YYYY-MM-DD date (no time-zone shift). */
export function formatDateLabel(date: string, withYear = false): string {
  const [y, m, d] = date.split('-').map(Number);
  const f = formatter(`d|${withYear}`, () =>
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: withYear ? 'numeric' : undefined,
      timeZone: 'UTC',
    }),
  );
  return f.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function localDate(nowMs: number, timeZone: string): string {
  const f = formatter(`ld|${timeZone}`, () =>
    new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }),
  );
  return f.format(new Date(nowMs));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 00:42:18 */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "2h 05m", "12m", "45s" */
export function formatShort(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}

export function describeOffset(offset: number): string {
  if (offset === 0) return 'At prayer time';
  return offset < 0 ? `${-offset} min before` : `${offset} min after`;
}

export function shortOffset(offset: number): string {
  if (offset === 0) return 'At time';
  return offset < 0 ? `−${-offset}m` : `+${offset}m`;
}

export function reminderSummary(cfg: PrayerNotificationConfig | undefined): string {
  if (!cfg || !cfg.enabled) return 'Off';
  const on = cfg.reminders.filter((r) => r.enabled).sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  if (on.length === 0) return 'No reminders';
  return on.map((r) => describeOffset(r.offsetMinutes)).join(' · ');
}

export interface NextEntry {
  entry: PrayerTimeEntry;
  date: string;
  secondsRemaining: number;
}

/** First entry after `nowMs` (Sunrise excluded unless asked). */
export function findNext(schedules: DailyPrayerSchedule[], nowMs: number, includeSunrise = false): NextEntry | null {
  let best: NextEntry | null = null;
  for (const s of schedules) {
    for (const e of s.entries) {
      if (!includeSunrise && e.prayer === 'sunrise') continue;
      const t = Date.parse(e.time);
      if (t <= nowMs) continue;
      if (!best || t < Date.parse(best.entry.time)) {
        best = { entry: e, date: s.date, secondsRemaining: (t - nowMs) / 1000 };
      }
    }
  }
  return best;
}

/** The prayer whose time has started and not yet ended (for "current" styling). */
export function currentPrayer(schedule: DailyPrayerSchedule, nowMs: number): Prayer | null {
  let current: Prayer | null = null;
  for (const e of schedule.entries) {
    if (e.prayer === 'sunrise') continue;
    if (Date.parse(e.time) <= nowMs) current = e.prayer;
  }
  return current;
}

/** HH:MM (24h) at a time zone — for prefilling manual time inputs. */
export function hhmm(iso: string, timeZone: string): string {
  return formatter(`hm|${timeZone}`, () =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }),
  ).format(new Date(iso));
}

/** 0–1 progress from the previous prayer to `nextIso` (Sunrise ignored). */
export function prayerProgress(schedules: DailyPrayerSchedule[], nextIso: string, nowMs: number): number {
  const times = schedules
    .flatMap((s) => s.entries)
    .filter((e) => e.prayer !== 'sunrise')
    .map((e) => Date.parse(e.time))
    .sort((a, b) => a - b);
  const next = Date.parse(nextIso);
  const prev = [...times].reverse().find((t) => t < next) ?? next - 6 * 3600_000;
  return Math.min(1, Math.max(0, (nowMs - prev) / (next - prev)));
}
