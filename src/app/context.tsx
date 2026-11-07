import { createContext, useContext } from 'react';
import type { PrayerSnapshot } from '../island/lib/types';
import type { Permission } from './api';
import type { Scheme, ThemeChoice } from './theme';

export type Tab = 'today' | 'prayer' | 'calendar' | 'routine' | 'tools';
export type RoutineTab = 'reminders' | 'fitness' | 'cycle' | 'water' | 'timer' | 'todo' | 'clocks' | 'places';
/** The Prayer tab's sections. */
export type PrayerTab = 'prayer' | 'quran' | 'dua' | 'tasbih' | 'shikkha';
export const PRAYER_TABS: readonly PrayerTab[] = ['prayer', 'quran', 'dua', 'tasbih', 'shikkha'];
export type PrayerSection = 'reminders' | 'location' | 'calculation' | 'display' | 'timetable';

/** A full-screen page pushed over the tabs. */
export type Pushed =
  | { kind: 'tool'; id: string }
  | { kind: 'prayer-settings'; section: PrayerSection }
  | { kind: 'upcoming' }
  | { kind: 'settings' }
  | { kind: 'ramadan' }
  | { kind: 'calendar-settings' }
  | { kind: 'about' }
  | { kind: 'optimize' }
  | { kind: 'voice' }
  | { kind: 'quran'; surah?: number; ayah?: number };

export interface NoorCtx {
  snapshot: PrayerSnapshot | null;
  prayerError: string | null;
  reloadPrayer: () => Promise<void>;
  tab: Tab;
  routineTab: RoutineTab;
  prayerTab: PrayerTab;
  setPrayerTab: (t: PrayerTab) => void;
  /** Switch tab; Quran, Dua and Tasbih live under Prayer (old 'routine' links are redirected). */
  go: (tab: Tab, sub?: RoutineTab | PrayerTab) => void;
  push: (p: Pushed) => void;
  permission: Permission | null;
  askPermission: () => Promise<Permission>;
  theme: ThemeChoice;
  scheme: Scheme;
  setTheme: (t: ThemeChoice) => void;
  /** Short message at the bottom of the screen. */
  flash: (text: string) => void;
}

export const Ctx = createContext<NoorCtx | null>(null);

export function useNoor(): NoorCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNoor outside <NoorApp>');
  return v;
}
