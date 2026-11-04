import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';

export type SalahStatus = 'jamaat' | 'onTime' | 'late' | 'missed';
export type SalahPrayer = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const SALAH_PRAYERS: SalahPrayer[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export interface SalahMark {
  date: string;
  prayer: SalahPrayer;
  status: SalahStatus;
}

export interface Qaza {
  fajr: number;
  dhuhr: number;
  asr: number;
  maghrib: number;
  isha: number;
  witr: number;
  madeUp: number;
}

export interface SalahStats {
  streak: number;
  bestStreak: number;
  weekPrayed: number;
  weekJamaat: number;
  weekMissed: number;
  onTimePct: number;
}

export interface SalahOverview {
  marks: SalahMark[];
  stats: SalahStats;
  qaza: Qaza;
  today: string;
}

export const STATUS_INFO: Record<SalahStatus, { en: string; bn: string; color: string }> = {
  jamaat: { en: 'With jamaat', bn: 'জামাতে', color: '#17905f' },
  onTime: { en: 'On time', bn: 'সময়মতো', color: '#3cbf86' },
  late: { en: 'Late', bn: 'দেরিতে', color: '#e0a23a' },
  missed: { en: 'Missed', bn: 'ক্বাযা হয়েছে', color: '#e5484d' },
};

export const qazaTotal = (q: Qaza) => q.fajr + q.dhuhr + q.asr + q.maghrib + q.isha + q.witr;

const EVENT = 'noor:salah';
const ping = () => window.dispatchEvent(new Event(EVENT));

export const salah = {
  overview: (from: string, to: string) => invoke<SalahOverview>('salah_overview', { from, to }),
  set: async (date: string, prayer: SalahPrayer, status: SalahStatus | null) => {
    const q = await invoke<Qaza>('salah_set', { date, prayer, status });
    ping();
    return q;
  },
  saveQaza: async (qaza: Qaza) => {
    const q = await invoke<Qaza>('qaza_save', { qaza });
    ping();
    return q;
  },
  madeUp: async (prayer: SalahPrayer | 'witr') => {
    const q = await invoke<Qaza>('qaza_made_up', { prayer });
    ping();
    return q;
  },
};

/** Salah marks for a date range, kept fresh when anything changes. */
export function useSalah(from: string, to: string) {
  const [data, setData] = useState<SalahOverview | null>(null);
  const reload = useCallback(() => {
    salah
      .overview(from, to)
      .then(setData)
      .catch(() => undefined);
  }, [from, to]);
  useEffect(() => {
    reload();
    window.addEventListener(EVENT, reload);
    const un = listen<string>('widgets://changed', (e) => e.payload === 'salah' && reload());
    return () => {
      window.removeEventListener(EVENT, reload);
      void un.then((f) => f()).catch(() => undefined);
    };
  }, [reload]);
  const status = (date: string, prayer: string) => data?.marks.find((m) => m.date === date && m.prayer === prayer)?.status ?? null;
  return { data, reload, status };
}
