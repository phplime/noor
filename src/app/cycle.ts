import { invoke } from '@tauri-apps/api/core';

/** Cycle tracker — data and predictions live in crates/nexa-widgets/src/cycle.rs. */

export interface CycleSettings {
  name: string;
  cycleLen: number;
  periodLen: number;
  lutealLen: number;
  remindPeriod: boolean;
  remindDaysBefore: number;
  remindFertile: boolean;
  remindTime: string;
  discreet: boolean;
}

export interface Period {
  start: string;
  end: string | null;
}

export interface DayLog {
  date: string;
  /** 0 none · 1 spotting · 2 light · 3 medium · 4 heavy */
  flow: number;
  symptoms: string[];
  mood: string;
  note: string;
}

export interface CycleData {
  settings: CycleSettings;
  periods: Period[];
  logs: DayLog[];
}

export type Phase = 'none' | 'period' | 'follicular' | 'fertile' | 'ovulation' | 'luteal' | 'late';
export type DayKind = 'period' | 'predictedPeriod' | 'fertile' | 'ovulation' | 'lowerChance' | 'other';
export type Regularity = 'unknown' | 'regular' | 'somewhatIrregular' | 'irregular';

export interface CycleDay {
  date: string;
  kind: DayKind;
  cycleDay: number | null;
  logged: boolean;
}

export interface CycleStatus {
  hasData: boolean;
  cyclesLogged: number;
  avgCycle: number;
  avgPeriod: number;
  shortest: number | null;
  longest: number | null;
  regularity: Regularity;
  history: number[];
  lastStart: string | null;
  cycleDay: number | null;
  phase: Phase;
  nextStart: string | null;
  nextWindow: [string, string] | null;
  daysUntilNext: number | null;
  lateDays: number;
  ovulation: string | null;
  fertileStart: string | null;
  fertileEnd: string | null;
  calendarFertileDays: [number, number] | null;
  calendarNote: string;
  insights: string[];
  days: CycleDay[];
}

export const cycleApi = {
  get: () => invoke<CycleData>('cycle_get'),
  save: (data: CycleData) => invoke<CycleData>('cycle_save', { data }),
  status: () => invoke<CycleStatus>('cycle_status'),
};

export const PHASE_LABEL: Record<Phase, string> = {
  none: 'Not started',
  period: 'Period',
  follicular: 'Follicular phase',
  fertile: 'Fertile window',
  ovulation: 'Ovulation day (estimated)',
  luteal: 'Luteal phase',
  late: 'Period is late',
};

export const PHASE_HINT: Record<Phase, string> = {
  none: 'Log the first day of the last period to begin.',
  period: 'Rest, stay warm and drink water. Iron-rich food helps.',
  follicular: 'Energy usually rises in these days.',
  fertile: 'Higher chance of pregnancy in these days.',
  ovulation: 'The most fertile day — an estimate.',
  luteal: 'PMS signs like cramps or mood changes can show up near the end.',
  late: 'Log the start when it comes. A test or a doctor can confirm if needed.',
};

export const SYMPTOMS = ['Cramps', 'Headache', 'Back pain', 'Bloating', 'Tender breasts', 'Acne', 'Tired', 'Nausea', 'Cravings', 'Insomnia'];
export const MOODS = ['😊 Good', '😐 Okay', '😢 Low', '😠 Irritable', '😰 Anxious', '😴 Tired'];
export const FLOW = ['None', 'Spotting', 'Light', 'Medium', 'Heavy'];
