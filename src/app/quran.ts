/** Qur'an data (bundled in /quran) and reading progress. */

export interface SurahInfo {
  n: number;
  ar: string;
  en: string;
  bn: string;
  type: 'meccan' | 'medinan';
  ayahs: number;
}

export interface Surah {
  n: number;
  /** [arabic, bangla meaning, bangla pronunciation] per ayah. */
  v: [string, string, string?][];
}

export interface DailyAyah {
  s: number;
  a: number;
  ar: string;
  bn: string;
  /** Bangla pronunciation. */
  tr?: string;
}

export interface QuranState {
  last: { s: number; a: number; at: number } | null;
  bookmarks: { s: number; a: number; at: number }[];
  fontSize: number;
  showBn: boolean;
  /** Bangla pronunciation (উচ্চারণ). */
  showTr: boolean;
  /** Arabic font: clear (Scheherazade New, easy for new readers) or classic (Amiri Quran). */
  font: 'clear' | 'classic';
  /** Heavier letters. */
  bold: boolean;
  /** Extra space between words. */
  wide: boolean;
}

const KEY = 'noor.quran.v1';
const DEFAULT: QuranState = { last: null, bookmarks: [], fontSize: 34, showBn: true, showTr: true, font: 'clear', bold: true, wide: true };

const base = () => `${import.meta.env.BASE_URL || '/'}quran/`;

const cache = new Map<string, Promise<unknown>>();
function load<T>(file: string): Promise<T> {
  let p = cache.get(file);
  if (!p) {
    p = fetch(base() + file).then((r) => {
      if (!r.ok) throw new Error('The Qur’an text could not be loaded');
      return r.json();
    });
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p as Promise<T>;
}

export const quran = {
  index: () => load<SurahInfo[]>('index.json'),
  surah: (n: number) => load<Surah>(`${n}.json`),
  daily: () => load<DailyAyah[]>('daily.json'),
};

export function readState(): QuranState {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<QuranState>) };
  } catch {
    return DEFAULT;
  }
}

export function saveState(patch: Partial<QuranState>): QuranState {
  const next = { ...readState(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function toggleBookmark(s: number, a: number): QuranState {
  const st = readState();
  const has = st.bookmarks.some((b) => b.s === s && b.a === a);
  return saveState({ bookmarks: has ? st.bookmarks.filter((b) => !(b.s === s && b.a === a)) : [{ s, a, at: Date.now() }, ...st.bookmarks].slice(0, 200) });
}

/** The same verse all day, a different one each day. */
export function ayahOfDay(list: DailyAyah[], date: string): DailyAyah | null {
  if (!list.length) return null;
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return list[((days % list.length) + list.length) % list.length];
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const bnNum = (n: number) => String(n).replace(/\d/g, (d) => BN_DIGITS[+d]);
export const arNum = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

export const BISMILLAH = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';
