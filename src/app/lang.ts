import { useEffect, useState } from 'react';

/** App language: বাংলা, English, or Banglish (English menus with Bangla alongside — Noor's original style). */
export type Lang = 'bn' | 'en' | 'mix';

const KEY = 'noor.lang.v1';

export function getLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'bn' || v === 'en' || v === 'mix' ? v : 'mix';
  } catch {
    return 'mix';
  }
}

export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event('noor:lang'));
}

export function useLang(): Lang {
  const [l, set] = useState(getLang);
  useEffect(() => {
    const on = () => set(getLang());
    window.addEventListener('noor:lang', on);
    return () => window.removeEventListener('noor:lang', on);
  }, []);
  return l;
}

/** Content (Quran meaning, duas) is English only in English mode; Banglish keeps Bangla content. */
export const isEn = (l: Lang) => l === 'en';

export const LANG_LABEL: Record<Lang, string> = { bn: 'বাংলা', en: 'English', mix: 'Banglish' };

const PRAYER: Record<string, [string, string]> = {
  fajr: ['ফজর', 'Fajr'],
  sunrise: ['সূর্যোদয়', 'Sunrise'],
  dhuhr: ['যোহর', 'Dhuhr'],
  asr: ['আসর', 'Asr'],
  maghrib: ['মাগরিব', 'Maghrib'],
  isha: ['এশা', 'Isha'],
};

/** Prayer name in the app language (Banglish shows the English name). */
export function prayerLabel(key: string, l: Lang): string {
  const p = PRAYER[key.toLowerCase()];
  if (!p) return key;
  return l === 'bn' ? p[0] : p[1];
}
