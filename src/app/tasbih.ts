/** Tasbih: the dhikr list, when to say each one, and saved counts (kept on this iPhone). */

export interface Dhikr {
  id: string;
  ar: string;
  en: string;
  meaning: string;
  bn: string;
  when: string;
  target: number;
}

export const DHIKR: Dhikr[] = [
  { id: 'subhanallah', ar: 'سُبْحَانَ اللَّهِ', en: 'SubhanAllah', meaning: 'Glory be to Allah', bn: 'আল্লাহ পবিত্র', when: 'After every fard prayer — 33 times', target: 33 },
  { id: 'alhamdulillah', ar: 'الْحَمْدُ لِلَّهِ', en: 'Alhamdulillah', meaning: 'All praise is for Allah', bn: 'সকল প্রশংসা আল্লাহর', when: 'After every fard prayer — 33 times. Also after eating, sneezing and good news', target: 33 },
  { id: 'allahuakbar', ar: 'اللَّهُ أَكْبَرُ', en: 'Allahu Akbar', meaning: 'Allah is the Greatest', bn: 'আল্লাহ সর্বশ্রেষ্ঠ', when: 'After every fard prayer — 34 times', target: 34 },
  { id: 'astaghfirullah', ar: 'أَسْتَغْفِرُ اللَّهَ', en: 'Astaghfirullah', meaning: 'I seek Allah’s forgiveness', bn: 'আমি আল্লাহর কাছে ক্ষমা চাই', when: '3 times right after salam; 100 times through the day', target: 100 },
  { id: 'tahlil', ar: 'لَا إِلَٰهَ إِلَّا اللَّهُ', en: 'La ilaha illallah', meaning: 'There is no god but Allah', bn: 'আল্লাহ ছাড়া কোনো উপাস্য নেই', when: 'Any time — the best remembrance', target: 100 },
  { id: 'subhanallahi-wa-bihamdihi', ar: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', en: 'SubhanAllahi wa bihamdihi', meaning: 'Glory and praise be to Allah', bn: 'আল্লাহ পবিত্র এবং সকল প্রশংসা তাঁর', when: '100 times a day, morning or evening', target: 100 },
  { id: 'salawat', ar: 'اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ', en: 'Allahumma salli ‘ala Muhammad', meaning: 'O Allah, send blessings upon Muhammad ﷺ', bn: 'হে আল্লাহ, মুহাম্মদ (সা.)-এর উপর রহমত বর্ষণ করুন', when: 'Often — especially on Friday', target: 100 },
  { id: 'hawqala', ar: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ', en: 'La hawla wa la quwwata illa billah', meaning: 'There is no power nor strength except with Allah', bn: 'আল্লাহ ছাড়া কোনো শক্তি ও সামর্থ্য নেই', when: 'In hardship, worry, or when starting something hard', target: 33 },
];

/** The tasbih after each fard prayer: 33 · 33 · 34. */
export const AFTER_SALAH = ['subhanallah', 'alhamdulillah', 'allahuakbar'];

export interface TasbihState {
  /** Current dhikr. */
  id: string;
  /** Count for the current round, per dhikr. */
  counts: Record<string, number>;
  /** Custom target per dhikr (0 = no limit). */
  targets: Record<string, number>;
  /** Run 33 · 33 · 34 in order, moving on by itself. */
  afterSalah: boolean;
  tapSound: boolean;
  /** Totals for `day` (YYYY-MM-DD) and all time. */
  day: string;
  today: number;
  total: number;
  /** Completed rounds today. */
  rounds: number;
  /** Days in a row with any dhikr; `lastDay` = last such day. */
  streak: number;
  lastDay: string;
}

const KEY = 'noor.tasbih.v1';

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function defaultTasbih(): TasbihState {
  return { id: 'subhanallah', counts: {}, targets: {}, afterSalah: false, tapSound: false, day: todayKey(), today: 0, total: 0, rounds: 0, streak: 0, lastDay: '' };
}

export function loadTasbih(): TasbihState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TasbihState> | null;
    const s = { ...defaultTasbih(), ...(raw ?? {}) };
    if (!DHIKR.some((d) => d.id === s.id)) s.id = 'subhanallah';
    return rollDay(s);
  } catch {
    return defaultTasbih();
  }
}

export function saveTasbih(s: TasbihState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full / private */
  }
}

/** A new day starts today's totals from zero (counts on the beads stay). */
export function rollDay(s: TasbihState, now = new Date()): TasbihState {
  const k = todayKey(now);
  return s.day === k ? s : { ...s, day: k, today: 0, rounds: 0 };
}

export function targetOf(s: TasbihState, d: Dhikr): number {
  return s.targets[d.id] ?? d.target;
}

function yesterday(k: string): string {
  const [y, m, d] = k.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d - 1));
}

/**
 * One tap. Returns the new state and what happened, so the screen can react
 * (finished a round, moved to the next dhikr of the after-salah set …).
 */
export function tap(prev: TasbihState, now = new Date()): { state: TasbihState; done: boolean; next: string | null } {
  const s = rollDay(prev, now);
  const d = DHIKR.find((x) => x.id === s.id) ?? DHIKR[0];
  const target = targetOf(s, d);
  const count = (s.counts[d.id] ?? 0) + 1;
  const k = todayKey(now);
  const streak = s.lastDay === k ? s.streak : s.lastDay === yesterday(k) ? s.streak + 1 : 1;
  let state: TasbihState = { ...s, counts: { ...s.counts, [d.id]: count }, today: s.today + 1, total: s.total + 1, streak, lastDay: k };
  const done = target > 0 && count >= target;
  let next: string | null = null;
  if (done) {
    state = { ...state, rounds: state.rounds + 1 };
    if (state.afterSalah) {
      const i = AFTER_SALAH.indexOf(d.id);
      if (i >= 0 && i < AFTER_SALAH.length - 1) {
        next = AFTER_SALAH[i + 1];
        state = { ...state, id: next, counts: { ...state.counts, [next]: 0 } };
      }
    }
  }
  return { state, done, next };
}

/** Which dhikr fits right now: after a prayer → the after-salah set. */
export function suggestion(prayerTimes: { name: string; time: number }[], now = Date.now()): { title: string; ids: string[] } | null {
  const recent = [...prayerTimes].reverse().find((p) => p.time <= now && now - p.time < 45 * 60_000);
  if (recent) return { title: `After ${recent.name}: SubhanAllah 33 · Alhamdulillah 33 · Allahu Akbar 34`, ids: AFTER_SALAH };
  const day = new Date(now).getDay();
  if (day === 5) return { title: 'It’s Friday — send salawat on the Prophet ﷺ often', ids: ['salawat'] };
  return null;
}
