import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api, errorText } from './ipc';
import { localDate } from './time';
import type { PrayerSnapshot } from './types';

/**
 * Current prayer snapshot. Reloads when any window saves settings
 * (`prayer://changed`) and when the date changes at the prayer location.
 */
export function usePrayerSnapshot() {
  const [snapshot, setSnapshot] = useState<PrayerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const un = listen('prayer://changed', () => void reload());
    const onVisible = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      void un.then((f) => f());
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  // Midnight / time-zone change at the location → new schedule.
  useEffect(() => {
    if (!snapshot) return;
    const id = window.setInterval(() => {
      if (localDate(Date.now(), snapshot.activeLocation.timezone) !== snapshot.today.date) void reload();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [snapshot, reload]);

  return { snapshot, error, reload };
}

/**
 * A clock that ticks every `intervalMs`, aligned to the wall-clock second, and
 * stops while the window is hidden so the island costs nothing when not visible.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      if (document.hidden) return;
      const delay = intervalMs - (Date.now() % Math.min(intervalMs, 1000)) + 5;
      timer = window.setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, delay);
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) {
        setNow(Date.now());
        schedule();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
  return now;
}

/**
 * Local editable copy of a server value that saves itself after `delay` ms of
 * inactivity. Incoming server updates replace the draft only when nothing is
 * pending, so a reload never wipes what the user is typing.
 */
export function useAutoSave<T>(serverValue: T | undefined, save: (v: T) => Promise<unknown>, delay = 450) {
  const [draft, setDraftState] = useState<T | undefined>(serverValue);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!pending.current) setDraftState(serverValue);
  }, [serverValue]);

  const flush = useCallback(async (value: T) => {
    setStatus('saving');
    try {
      await saveRef.current(value);
      setStatus('saved');
      setError(null);
    } catch (e) {
      setStatus('error');
      setError(errorText(e));
    } finally {
      pending.current = false;
    }
  }, []);

  const latest = useRef<T | undefined>(serverValue);

  const setDraft = useCallback(
    (next: T | ((prev: T) => T)) => {
      setDraftState((prev) => {
        const value = typeof next === 'function' ? (next as (p: T) => T)(prev as T) : next;
        latest.current = value;
        pending.current = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void flush(value), delay);
        return value;
      });
    },
    [delay, flush],
  );

  // Leaving the screen with unsaved edits saves them immediately.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current && latest.current !== undefined) void saveRef.current(latest.current);
    },
    [],
  );

  return { draft, setDraft, status, error };
}
