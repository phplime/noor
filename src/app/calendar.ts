import { invoke } from '@tauri-apps/api/core';

/** Calendar, Ramadan, special days and profile — backed by crates/nexa-widgets (calendar.rs …). */

export interface Hijri {
  year: number;
  month: number;
  day: number;
}
export type Bangla = Hijri;

export type OccasionKind = 'holiday' | 'islamic' | 'fasting' | 'special';

export interface Occasion {
  key: string;
  kind: OccasionKind;
  en: string;
  bn: string;
  ar: string;
  userId: string | null;
}

export interface DayInfo {
  date: string;
  /** 0 = Sunday */
  weekday: number;
  hijri: Hijri;
  bangla: Bangla;
  occasions: Occasion[];
}

export interface Dated {
  date: string;
  occasion: Occasion;
}

export interface CalendarSettings {
  hijriAdjust: number;
  holidayAlerts: boolean;
  showFastingDays: boolean;
  /** Mark every Monday and Thursday as a Sunnah fast. */
  mondayThursday: boolean;
  /** Remind at 9 pm the evening before a Sunnah fast. */
  fastingAlerts: boolean;
  /** Friday: Surah Al-Kahf, Jumu'ah and durud reminders. */
  fridayReminders: boolean;
  /** "HH:MM" for the Al-Kahf reminder. */
  kahfTime: string;
  /** Notify when a no-salah (makruh) time starts and ends. */
  makruhAlerts: boolean;
}

export type DateKind = 'gregorian' | 'hijri';

export interface SpecialDay {
  id: string;
  title: string;
  note: string;
  calendar: DateKind;
  month: number;
  day: number;
  year: number | null;
  alert: boolean;
  alertTime: string;
  daysBefore: number;
  sound: string;
  color: string;
  createdAt: number;
}
export type SpecialInput = Omit<SpecialDay, 'id' | 'createdAt'> & { id?: string };

export interface RamadanSettings {
  enabled: boolean;
  overrideYear: number | null;
  overrideStart: string | null;
  sehriEndBeforeFajrMin: number;
  wakeBeforeMin: number;
  sehriWarningMin: number;
  iftarHeadsupMin: number;
  iftarAlert: boolean;
  leanPrayerAlerts: boolean;
  wakeSound: string;
  iftarSound: string;
}

export interface RamadanDay {
  date: string;
  dayNo: number;
  fajr: string;
  sehriEnd: string;
  wake: string;
  maghrib: string;
}

export interface RamadanStatus {
  settings: RamadanSettings;
  hijriYear: number;
  start: string;
  end: string;
  phase: 'upcoming' | 'during';
  daysUntil: number;
  dayNo: number;
  daysLeft: number;
  isEstimate: boolean;
  queuedThrough: string | null;
  timetable: RamadanDay[];
}

export interface Profile {
  name: string;
  avatar: string | null;
  cover: string | null;
  photos: string[];
  /** "MM-DD" */
  birthday: string | null;
}

export const cal = {
  settings: () => invoke<CalendarSettings>('calendar_settings'),
  saveSettings: (settings: CalendarSettings) => invoke<CalendarSettings>('calendar_save_settings', { settings }),
  month: (year: number, month: number) => invoke<DayInfo[]>('calendar_month', { year, month }),
  day: (date: string) => invoke<DayInfo>('calendar_day', { date }),
  upcoming: (from: string, days: number, fasting = false) => invoke<Dated[]>('calendar_upcoming', { from, days, fasting }),

  specials: () => invoke<SpecialDay[]>('special_list'),
  specialSave: (special: SpecialInput) => invoke<SpecialDay>('special_save', { special }),
  specialDelete: (id: string) => invoke<void>('special_delete', { id }),

  profile: () => invoke<Profile>('profile_get'),
  profileSave: (profile: Profile) => invoke<Profile>('profile_save', { profile }),

  ramadanSettings: () => invoke<RamadanSettings>('ramadan_settings'),
  ramadanSave: (settings: RamadanSettings) => invoke<RamadanSettings>('ramadan_save_settings', { settings }),
  ramadan: () => invoke<RamadanStatus>('ramadan_status'),
};

// ----- dates & numerals ---------------------------------------------------------

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse "YYYY-MM-DD" as a local date. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export const toBn = (n: number | string) => String(n).replace(/\d/g, (c) => BN_DIGITS[+c]);
export const toAr = (n: number | string) => String(n).replace(/\d/g, (c) => AR_DIGITS[+c]);

export const BANGLA_MONTHS = ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন', 'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'];
export const BANGLA_SEASONS = ['গ্রীষ্ম', 'বর্ষা', 'শরৎ', 'হেমন্ত', 'শীত', 'বসন্ত'];
export const BANGLA_WEEKDAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
export const HIJRI_MONTHS_AR = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
export const HIJRI_MONTHS_EN = ["Muharram", "Safar", "Rabi' al-awwal", "Rabi' al-thani", 'Jumada al-awwal', 'Jumada al-thani', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah'];
export const HIJRI_MONTHS_BN = ['মহররম', 'সফর', 'রবিউল আউয়াল', 'রবিউস সানি', 'জমাদিউল আউয়াল', 'জমাদিউস সানি', 'রজব', 'শাবান', 'রমজান', 'শাওয়াল', 'জিলকদ', 'জিলহজ'];
export const ARABIC_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const banglaLong = (b: Bangla) => `${toBn(b.day)} ${BANGLA_MONTHS[b.month - 1]} ${toBn(b.year)}`;
export const banglaSeason = (b: Bangla) => BANGLA_SEASONS[Math.floor((b.month - 1) / 2)];
export const hijriAr = (h: Hijri) => `${toAr(h.day)} ${HIJRI_MONTHS_AR[h.month - 1]} ${toAr(h.year)}`;
export const hijriBn = (h: Hijri) => `${toBn(h.day)} ${HIJRI_MONTHS_BN[h.month - 1]} ${toBn(h.year)} হিজরি`;
export const hijriEn = (h: Hijri) => `${h.day} ${HIJRI_MONTHS_EN[h.month - 1]} ${h.year} AH`;

/** "Fri, 16 Dec" */
export function shortDate(s: string): string {
  return parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Whole days from today (local) to a "YYYY-MM-DD" date. */
export function daysFromToday(s: string, now = new Date()): number {
  const a = parseYmd(ymd(now)).getTime();
  const b = parseYmd(s).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function inDays(n: number): string {
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n < 0) return `${-n} days ago`;
  return `in ${n} days`;
}

/** Name of the occasion in the best available language ("en" is always set). */
export function occasionName(o: Occasion, lang: 'en' | 'bn' | 'ar' = 'en'): string {
  return (lang === 'bn' ? o.bn : lang === 'ar' ? o.ar : o.en) || o.en;
}

/** Strongest first: holiday > islamic > special > fasting. */
export function topOccasion(list: Occasion[]): Occasion | undefined {
  const rank: Record<OccasionKind, number> = { holiday: 0, islamic: 1, special: 2, fasting: 3 };
  return [...list].sort((a, b) => rank[a.kind] - rank[b.kind])[0];
}
