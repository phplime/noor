import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import type { PrayerSnapshot } from '../island/lib/types';
import { PRAYER_NAMES } from '../island/lib/types';
import { activeMakruh, makruhWindows } from './makruh';
import { currentPeriod, dayTimes, nextPrayer, PERIOD_BN } from './periods';
import type { FitnessOverview } from './fitness';

/** Lock-screen prayer Live Activity (iPhone). */

const KEY = 'noor.live.v1';
const STEPS_KEY = 'noor.live.steps.v1';

export function liveStepsEnabled(): boolean {
  try {
    return localStorage.getItem(STEPS_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setLiveStepsEnabled(on: boolean) {
  try {
    localStorage.setItem(STEPS_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('noor:live'));
}

export function liveEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setLiveEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('noor:live'));
}

export const liveSupported = () => invoke<boolean>('live_activity_supported').catch(() => false);

export function livePayload(snapshot: PrayerSnapshot, now: number, steps?: { steps: number; goal: number; at: number } | null) {
  const days = [snapshot.today, snapshot.tomorrow];
  const t = dayTimes(days);
  if (!t) return null;
  const cur = currentPeriod(t, now);
  const next = nextPrayer(days, now);
  // After Isha the strip shows tomorrow's prayers.
  const stripDay = now >= t.isha && days[1] ? days[1] : days[0];
  const makruh = activeMakruh(makruhWindows(snapshot.today.entries), now);
  return {
    location: snapshot.activeLocation.name,
    current: cur.en,
    currentBn: PERIOD_BN[cur.key] ?? '',
    periodStart: cur.start,
    periodEnd: cur.end,
    next: next ? PRAYER_NAMES[next.prayer] : 'Fajr',
    nextAt: next ? Date.parse(next.time) : cur.end,
    makruhUntil: makruh ? makruh.end : null,
    slots: stripDay.entries.filter((e) => e.prayer !== 'sunrise').map((e) => ({ name: PRAYER_NAMES[e.prayer], at: Date.parse(e.time) })),
    steps: steps ? steps.steps : null,
    stepGoal: steps ? steps.goal : null,
    stepsAt: steps ? steps.at : null,
  };
}

/**
 * Keep the Live Activity in step: on open, when the app comes back to the
 * foreground, when the prayer period changes, and when settings change.
 */
export function useLiveActivity(snapshot: PrayerSnapshot | null) {
  const last = useRef('');
  useEffect(() => {
    if (!snapshot) return;
    let timer: number | undefined;
    let alive = true;
    const sync = async () => {
      window.clearTimeout(timer);
      if (!liveEnabled()) {
        last.current = '';
        void invoke('live_activity', { payload: null }).catch(() => undefined);
        return;
      }
      // Fresh step count from the iPhone (fitness_sync_steps reads the motion chip).
      let steps: { steps: number; goal: number; at: number } | null = null;
      if (liveStepsEnabled()) {
        try {
          // Direct call: fit.sync() would announce a change and re-trigger this sync.
          const o = await invoke<FitnessOverview>('fitness_sync_steps');
          steps = { steps: o.summary.stepsToday, goal: o.summary.stepGoal, at: Date.now() };
        } catch {
          steps = null;
        }
      }
      if (!alive) return;
      const now = Date.now();
      const p = livePayload(snapshot, now, steps);
      if (!p) return;
      // Compare without the read time so an unchanged count doesn't trigger an update.
      const json = JSON.stringify({ ...p, stepsAt: null });
      if (json !== last.current) {
        last.current = json;
        void invoke('live_activity', { payload: JSON.stringify(p) }).catch(() => {
          last.current = '';
        });
      }
      // Wake up at the next boundary (period end or makruh end), and every 10 min for steps, while open.
      const nextAt = Math.min(p.periodEnd, p.makruhUntil ?? Infinity);
      const cap = steps ? 10 * 60_000 : 30 * 60_000;
      // Only while Noor is on screen; iOS keeps the lock-screen countdown running by itself.
      if (!document.hidden) timer = window.setTimeout(() => void sync(), Math.max(5_000, Math.min(nextAt - now + 1_000, cap)));
    };
    const run = () => void sync();
    const onVisible = () => document.visibilityState === 'visible' && run();
    run();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('noor:live', run);
    window.addEventListener('noor:fitness', run);
    return () => {
      alive = false;
      window.removeEventListener('noor:fitness', run);
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('noor:live', run);
    };
  }, [snapshot]);
}
