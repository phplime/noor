import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';

export interface FitnessProfile {
  heightCm: number;
  goalKg: number;
  stepGoal: number;
  asianBmi: boolean;
  weighReminder: boolean;
  /** 1 = Monday … 7 = Sunday */
  weighDay: number;
  weighTime: string;
  /** 0 = not set */
  birthYear: number;
  sex: '' | 'male' | 'female';
}

export type Activity = 'sedentary' | 'low' | 'somewhat' | 'active' | 'very';
export type CheckLevel = 'good' | 'ok' | 'warn' | 'info';

export interface FitnessReport {
  days: number;
  from: string;
  to: string;
  totalSteps: number;
  avgSteps: number;
  best: { date: string; steps: number } | null;
  goalDays: number;
  km: number;
  walkKcal: number;
  activity: Activity;
  weightStart: number | null;
  weightEnd: number | null;
  weightChange: number | null;
  bmr: number | null;
  tdee: number | null;
  targetKcal: number | null;
  weeksToGoal: number | null;
  checks: { key: string; level: CheckLevel; title: string; detail: string }[];
  score: number;
  scoreOf: number;
}

export const ACTIVITY_INFO: Record<Activity, { en: string; bn: string }> = {
  sedentary: { en: 'Not very active', bn: 'কম সক্রিয়' },
  low: { en: 'A little active', bn: 'কিছুটা সক্রিয়' },
  somewhat: { en: 'Fairly active', bn: 'মোটামুটি সক্রিয়' },
  active: { en: 'Active', bn: 'সক্রিয়' },
  very: { en: 'Very active', bn: 'খুব সক্রিয়' },
};

export interface WeightEntry {
  date: string;
  kg: number;
}

export interface StepEntry {
  date: string;
  steps: number;
  source: string;
}

export type BmiBand = 'under' | 'healthy' | 'over' | 'obese';

export interface FitnessSummary {
  today: string;
  stepsToday: number;
  stepGoal: number;
  kmToday: number;
  kcalToday: number;
  stepsWeekAvg: number;
  stepStreak: number;
  weight: number | null;
  weightDate: string | null;
  change7d: number | null;
  change30d: number | null;
  bmi: number | null;
  bmiBand: BmiBand | null;
  healthyMinKg: number | null;
  healthyMaxKg: number | null;
  toGoalKg: number | null;
}

export interface FitnessOverview {
  data: { profile: FitnessProfile; weights: WeightEntry[]; steps: StepEntry[] };
  summary: FitnessSummary;
}

const EVENT = 'noor:fitness';
const ping = () => window.dispatchEvent(new Event(EVENT));

export const fit = {
  get: () => invoke<FitnessOverview>('fitness_get'),
  saveProfile: (profile: FitnessProfile) => invoke<FitnessOverview>('fitness_save_profile', { profile }).finally(ping),
  logWeight: (date: string, kg: number | null) => invoke<FitnessOverview>('fitness_log_weight', { date, kg }).finally(ping),
  setSteps: (date: string, steps: number) => invoke<FitnessOverview>('fitness_set_steps', { date, steps }).finally(ping),
  sync: () => invoke<FitnessOverview>('fitness_sync_steps').finally(ping),
  motion: () => invoke<boolean>('fitness_motion_available').catch(() => false),
  report: (days: number) => invoke<FitnessReport>('fitness_report', { days }),
};

export const BMI_INFO: Record<BmiBand, { en: string; bn: string; color: string }> = {
  under: { en: 'Underweight', bn: 'কম ওজন', color: '#4aa3e8' },
  healthy: { en: 'Healthy', bn: 'স্বাস্থ্যকর', color: '#2fb27f' },
  over: { en: 'Overweight', bn: 'বেশি ওজন', color: '#e6a33a' },
  obese: { en: 'Obese', bn: 'স্থূলতা', color: '#e5574f' },
};

export const cmToFtIn = (cm: number) => {
  const inches = cm / 2.54;
  const ft = Math.floor(inches / 12);
  return { ft, inch: Math.round(inches - ft * 12) };
};
export const ftInToCm = (ft: number, inch: number) => Math.round((ft * 12 + inch) * 2.54 * 10) / 10;

/** Fitness data, refreshed on changes. Syncs iPhone steps when shown. */
export function useFitness(syncOnOpen = false) {
  const [data, setData] = useState<FitnessOverview | null>(null);
  const reload = useCallback(() => {
    fit.get().then(setData, () => undefined);
  }, []);
  useEffect(() => {
    reload();
    if (syncOnOpen) fit.sync().then(setData, () => undefined);
    window.addEventListener(EVENT, reload);
    const un = listen<string>('widgets://changed', (e) => e.payload === 'fitness' && reload());
    const onVis = () => {
      if (document.visibilityState === 'visible' && syncOnOpen) fit.sync().then(setData, () => undefined);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener(EVENT, reload);
      document.removeEventListener('visibilitychange', onVis);
      void un.then((f) => f()).catch(() => undefined);
    };
  }, [reload, syncOnOpen]);
  return { data, setData, reload };
}

// ----- Live walk (Fitness › Start live) -----

export interface LiveReading {
  /** steps since the walk started */
  steps: number;
  /** metres since the walk started (null = the iPhone didn't measure it) */
  distanceM: number | null;
  /** current speed, m/s (0 when standing still) */
  speedMps: number;
  /** steps per minute right now */
  cadence: number;
}

export interface WalkSession {
  /** ms since 1970 */
  startMs: number;
  /** today's step total when the walk started */
  baseSteps: number;
}

export interface WalkRecord {
  start: number;
  end: number;
  steps: number;
  km: number;
  kcal: number;
  avgKmh: number;
}

const WALK_KEY = 'noor.walk.v1';
const WALKS_KEY = 'noor.walks.v1';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full / unavailable */
  }
}

export const recentWalks = (): WalkRecord[] => readJSON<WalkRecord[]>(WALKS_KEY, []);
/** The walk in progress, if any (for the Home shortcut). */
export const currentWalk = (): WalkSession | null => readJSON<WalkSession | null>(WALK_KEY, null);

const AUTOSTART_KEY = 'noor.walk.autostart';
/** Home › Start live walk: ask the Fitness screen to start a walk as soon as it opens. */
export function requestWalkStart() {
  try {
    sessionStorage.setItem(AUTOSTART_KEY, '1');
  } catch {
    /* ignore */
  }
}
/** True once, if Home asked for a walk to start. */
export function takeWalkStart(): boolean {
  try {
    const v = sessionStorage.getItem(AUTOSTART_KEY) === '1';
    sessionStorage.removeItem(AUTOSTART_KEY);
    return v;
  } catch {
    return false;
  }
}

interface RawLive {
  steps?: number;
  distanceM?: number;
  speedMps?: number;
  cadence?: number;
}

/**
 * A live walk that counts from zero. Runs only while the Fitness screen is on screen; if you
 * leave or lock the phone, it picks up the full count again when you come back (the iPhone keeps
 * counting steps in its motion chip). The walk survives closing the app until you press End.
 */
export function useLiveWalk(supported: boolean) {
  const [walk, setWalk] = useState<WalkSession | null>(() => (supported ? readJSON<WalkSession | null>(WALK_KEY, null) : null));
  const [reading, setReading] = useState<LiveReading | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!walk) return;
    let timer: number | undefined;
    let running = false;
    const read = () => {
      setNow(Date.now());
      invoke<RawLive>('fitness_live')
        .then((r) => {
          if (typeof r?.steps !== 'number') return;
          setReading({ steps: r.steps, distanceM: r.distanceM ?? null, speedMps: Math.max(0, r.speedMps ?? 0), cadence: Math.max(0, r.cadence ?? 0) });
        })
        .catch(() => undefined);
    };
    const start = () => {
      if (running) return;
      running = true;
      void invoke('fitness_live_start', { fromMs: walk.startMs }).catch(() => undefined);
      read();
      timer = window.setInterval(read, 1000);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      window.clearInterval(timer);
      void invoke('fitness_live_stop').catch(() => undefined);
    };
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop());
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [walk]);

  const begin = useCallback((todaySteps: number) => {
    const w = { startMs: Date.now(), baseSteps: todaySteps };
    writeJSON(WALK_KEY, w);
    setReading({ steps: 0, distanceM: 0, speedMps: 0, cadence: 0 });
    setNow(w.startMs);
    setWalk(w);
  }, []);

  /** End the walk: save it to the history and add its steps to today (re-read from the iPhone). */
  const end = useCallback(
    async (record: Omit<WalkRecord, 'start' | 'end'>) => {
      if (!walk) return null;
      const rec: WalkRecord = { ...record, start: walk.startMs, end: Date.now() };
      if (rec.steps > 0) writeJSON(WALKS_KEY, [rec, ...recentWalks()].slice(0, 30));
      writeJSON(WALK_KEY, null);
      setWalk(null);
      setReading(null);
      await invoke('fitness_live_stop').catch(() => undefined);
      return fit.sync().catch(() => null);
    },
    [walk],
  );

  const elapsedS = walk ? Math.max(0, Math.round((now - walk.startMs) / 1000)) : 0;
  return { walk, reading, elapsedS, begin, end };
}

/** Same estimate as the Rust summary: ≈0.04 kcal per step for 70 kg, scaled by body weight. */
export const stepKcal = (steps: number, kg: number | null) => Math.round((steps * 0.04 * (kg ?? 65)) / 70);
/** Stride ≈ 0.415 × height. */
export const stepKm = (steps: number, heightCm: number) => (steps * (heightCm || 165) * 0.415) / 100_000;
