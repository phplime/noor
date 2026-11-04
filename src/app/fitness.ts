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
