/**
 * TypeScript twin of crates/nexa-widgets/src/{calendar,ramadan}.rs — used only by the
 * browser preview (dev/mock.ts) and checked against the same known dates in tests/dev-mockcal.test.ts.
 */
import type { Bangla, DayInfo, Dated, Hijri, Occasion, OccasionKind, SpecialDay } from '../app/calendar';

const EPOCH = 1_948_440;

export const pad = (n: number) => String(n).padStart(2, '0');
export const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const jdnOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000) + 2_440_588;
export function fromJdn(j: number): [number, number, number] {
  const dt = new Date((j - 2_440_588) * 86_400_000);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}
export const parts = (s: string): [number, number, number] => s.split('-').map(Number) as [number, number, number];
export const jdnOfStr = (s: string) => jdnOf(...parts(s));
export const addDays = (s: string, n: number) => fmt(...fromJdn(jdnOfStr(s) + n));

export function hijriToJdn(y: number, m: number, d: number) {
  return d + Math.floor((59 * (m - 1) + 1) / 2) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + EPOCH - 1;
}
export function jdnToHijri(j: number): Hijri {
  const y = Math.floor((30 * (j - EPOCH) + 10646) / 10631);
  const first = hijriToJdn(y, 1, 1);
  const m = Math.min(12, Math.max(1, Math.floor((2 * (j - 29 - first) + 58) / 59) + 1));
  return { year: y, month: m, day: j - hijriToJdn(y, m, 1) + 1 };
}
export const hijriMonthLen = (y: number, m: number) => (m === 12 ? hijriToJdn(y + 1, 1, 1) : hijriToJdn(y, m + 1, 1)) - hijriToJdn(y, m, 1);
export const hijriFor = (date: string, adjust: number) => jdnToHijri(jdnOfStr(date) + adjust);
export const dateForHijri = (y: number, m: number, d: number, adjust: number) => fmt(...fromJdn(hijriToJdn(y, m, d) - adjust));

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function banglaFor(date: string): Bangla {
  const [y, m, d] = parts(date);
  const startYear = m > 4 || (m === 4 && d >= 14) ? y : y - 1;
  let left = jdnOf(y, m, d) - jdnOf(startYear, 4, 14);
  const lens = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, isLeap(startYear + 1) ? 30 : 29, 30];
  for (let i = 0; i < 12; i++) {
    if (left < lens[i]) return { year: startYear - 593, month: i + 1, day: left + 1 };
    left -= lens[i];
  }
  return { year: startYear - 593, month: 12, day: 30 };
}

const weekdayOf = (date: string) => new Date(...(([y, m, d]) => [y, m - 1, d] as [number, number, number])(parts(date))).getDay();

const occ = (key: string, kind: OccasionKind, en: string, bn: string, ar = ''): Occasion => ({ key, kind, en, bn, ar, userId: null });

export function builtin(date: string, adjust: number, fasting: boolean): Occasion[] {
  const out: Occasion[] = [];
  const [, m, d] = parts(date);
  const fixed: Record<string, Occasion> = {
    '2-21': occ('shaheed', 'holiday', 'Shaheed Day & International Mother Language Day', 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস'),
    '3-26': occ('independence', 'holiday', 'Independence Day', 'স্বাধীনতা দিবস'),
    '4-14': occ('boishakh', 'holiday', 'Pohela Boishakh', 'পহেলা বৈশাখ'),
    '5-1': occ('mayday', 'holiday', 'May Day', 'মে দিবস'),
    '8-5': occ('uprising', 'holiday', 'July Mass Uprising Day', 'জুলাই গণ-অভ্যুত্থান দিবস'),
    '12-16': occ('victory', 'holiday', 'Victory Day', 'বিজয় দিবস'),
    '12-25': occ('christmas', 'holiday', 'Christmas Day', 'বড়দিন'),
  };
  if (fixed[`${m}-${d}`]) out.push(fixed[`${m}-${d}`]);
  const h = hijriFor(date, adjust);
  const k = `${h.month}-${h.day}`;
  const islamic: Record<string, Occasion | null> = {
    '1-1': occ('hijri-new-year', 'islamic', 'Islamic New Year', 'ইসলামী নববর্ষ', 'رأس السنة الهجرية'),
    '1-9': fasting ? occ('tasua', 'fasting', "Tasu'a — fasting day", 'তাসুআ — রোজার দিন', 'تاسوعاء') : null,
    '1-10': occ('ashura', 'holiday', 'Ashura', 'আশুরা', 'عاشوراء'),
    '3-12': occ('milad', 'holiday', 'Eid-e-Miladunnabi', 'ঈদে মিলাদুন্নবী', 'المولد النبوي'),
    '8-15': occ('shab-e-barat', 'holiday', 'Shab-e-Barat', 'শবে বরাত', 'ليلة البراءة'),
    '9-1': occ('ramadan-begins', 'islamic', 'Ramadan begins', 'রমজান শুরু', 'بداية رمضان'),
    '9-27': occ('shab-e-qadr', 'holiday', 'Shab-e-Qadr', 'শবে কদর', 'ليلة القدر'),
    '10-1': occ('eid-fitr-1', 'holiday', 'Eid ul-Fitr', 'ঈদুল ফিতর', 'عيد الفطر'),
    '10-2': occ('eid-fitr-2', 'holiday', 'Eid ul-Fitr · day 2', 'ঈদুল ফিতর · ২য় দিন', 'عيد الفطر'),
    '10-3': occ('eid-fitr-3', 'holiday', 'Eid ul-Fitr · day 3', 'ঈদুল ফিতর · ৩য় দিন', 'عيد الفطر'),
    '12-9': fasting ? occ('arafah', 'fasting', 'Day of Arafah — fasting day', 'আরাফার দিন — রোজার দিন', 'يوم عرفة') : null,
    '12-10': occ('eid-adha', 'holiday', 'Eid ul-Adha', 'ঈদুল আযহা', 'عيد الأضحى'),
  };
  if (islamic[k]) out.push(islamic[k]!);
  if (weekdayOf(date) === 5 && h.month === 9 && hijriFor(addDays(date, 7), adjust).month !== 9) {
    out.push(occ('jumatul-bida', 'holiday', "Jumu'atul Bida", 'জুমাতুল বিদা', 'جمعة الوداع'));
  }
  if (fasting && h.day >= 13 && h.day <= 15 && h.month !== 9 && !(h.month === 12 && h.day === 13)) {
    out.push(occ('ayyam-al-bid', 'fasting', 'Ayyam al-Bid — fasting day', 'আইয়ামে বীজ — রোজার দিন', 'الأيام البيض'));
  }
  return out;
}

export function specialDates(s: SpecialDay, start: string, end: string, adjust: number): string[] {
  const out: string[] = [];
  const [sy] = parts(start);
  const [ey] = parts(end);
  if (s.calendar === 'gregorian') {
    for (let y = sy; y <= ey; y++) {
      if (s.year && s.year !== y) continue;
      let day = s.day;
      const dim = new Date(y, s.month, 0).getDate();
      if (day > dim) day = dim;
      const d = fmt(y, s.month, day);
      if (d >= start && d <= end) out.push(d);
    }
  } else {
    const h0 = hijriFor(start, adjust).year - 1;
    const h1 = hijriFor(end, adjust).year + 1;
    for (let hy = h0; hy <= h1; hy++) {
      if (s.year && s.year !== hy) continue;
      const d = dateForHijri(hy, s.month, Math.min(s.day, hijriMonthLen(hy, s.month)), adjust);
      if (d >= start && d <= end) out.push(d);
    }
  }
  return out;
}

export function dayInfo(date: string, adjust: number, fasting: boolean, specials: SpecialDay[]): DayInfo {
  const occasions = builtin(date, adjust, fasting);
  for (const s of specials) {
    if (specialDates(s, date, date, adjust).includes(date)) {
      occasions.push({ key: `special:${s.id}`, kind: 'special', en: s.title, bn: '', ar: '', userId: s.id });
    }
  }
  return { date, weekday: weekdayOf(date), hijri: hijriFor(date, adjust), bangla: banglaFor(date), occasions };
}

export function monthDays(year: number, month: number, adjust: number, fasting: boolean, specials: SpecialDay[]): DayInfo[] {
  const n = new Date(year, month, 0).getDate();
  return Array.from({ length: n }, (_, i) => dayInfo(fmt(year, month, i + 1), adjust, fasting, specials));
}

export function upcoming(from: string, days: number, adjust: number, fasting: boolean, includeFasting: boolean, specials: SpecialDay[]): Dated[] {
  const out: Dated[] = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(from, i);
    for (const o of dayInfo(d, adjust, fasting, specials).occasions) {
      if (includeFasting || o.kind !== 'fasting') out.push({ date: d, occasion: o });
    }
  }
  return out;
}
