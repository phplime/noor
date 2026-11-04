import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

/**
 * Load async data when `deps` change and again whenever the backend reports a
 * change in one of `modules` (event `widgets://changed`). Stale responses are dropped.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], modules: string[] = []): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(() => {
    const id = ++seq.current;
    loadRef
      .current()
      .then((v) => id === seq.current && setData(v))
      .catch(() => undefined);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);

  const key = modules.join('|');
  useEffect(() => {
    if (!modules.length) return;
    const un = listen<string>('widgets://changed', (e) => modules.includes(e.payload) && reload());
    return () => void un.then((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);

  return { data, reload };
}

/** Today's date as "YYYY-MM-DD" (local), updating at midnight. */
export function useToday(): string {
  const make = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [day, setDay] = useState(make);
  useEffect(() => {
    const t = window.setInterval(() => setDay(make()), 30_000);
    const onVis = () => !document.hidden && setDay(make());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return day;
}

/** Persisted Home layout (which cards, in what order). */
export type HomeCardId = 'date' | 'next' | 'shortcuts' | 'friday' | 'ayah' | 'ramadan' | 'occasions' | 'photos' | 'today' | 'coming';
export const HOME_CARDS: { id: HomeCardId; label: string; hint: string }[] = [
  { id: 'date', label: 'Date & holidays', hint: 'English, Bangla and Arabic date' },
  { id: 'next', label: 'Next prayer', hint: 'Countdown and the five prayers' },
  { id: 'shortcuts', label: 'Shortcuts', hint: 'Tasbih, water and timer in one tap' },
  { id: 'friday', label: "Jumu'ah checklist", hint: 'Shows on Fridays: Al-Kahf, ghusl, durud' },
  { id: 'ayah', label: 'Ayah of the day', hint: 'A verse with Bangla meaning' },
  { id: 'ramadan', label: 'Ramadan', hint: 'Sehri and Iftar, countdown to Ramadan' },
  { id: 'occasions', label: 'Special days', hint: 'Holidays and your own dates' },
  { id: 'photos', label: 'My photos', hint: 'Your favourite pictures' },
  { id: 'today', label: 'Today at a glance', hint: 'Water, timer, reminders, to-do' },
  { id: 'coming', label: 'Coming up', hint: 'Next alerts on this iPhone' },
];

export interface HomeLayout {
  order: HomeCardId[];
  hidden: HomeCardId[];
}

const LAYOUT_KEY = 'noor.home.v1';
const DEFAULT_LAYOUT: HomeLayout = { order: HOME_CARDS.map((c) => c.id), hidden: [] };

export function readLayout(): HomeLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<HomeLayout> | null;
    if (!raw || !Array.isArray(raw.order)) return DEFAULT_LAYOUT;
    const known = new Set<HomeCardId>(HOME_CARDS.map((c) => c.id));
    const order = raw.order.filter((id, i, a): id is HomeCardId => known.has(id) && a.indexOf(id) === i);
    // New cards (after an update) slot in next to their default neighbour.
    HOME_CARDS.forEach((c, i) => {
      if (order.includes(c.id)) return;
      const before = HOME_CARDS[i - 1]?.id;
      const at = before ? order.indexOf(before) : -1;
      order.splice(at >= 0 ? at + 1 : order.length, 0, c.id);
    });
    const hidden = (raw.hidden ?? []).filter((id): id is HomeCardId => known.has(id));
    return { order, hidden };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useHomeLayout(): [HomeLayout, (l: HomeLayout) => void] {
  const [layout, setLayout] = useState<HomeLayout>(readLayout);
  const save = useCallback((l: HomeLayout) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new CustomEvent('noor-home-layout', { detail: l }));
  }, []);
  // Home and Settings both edit the layout: keep them in step.
  useEffect(() => {
    const on = (e: Event) => setLayout((e as CustomEvent<HomeLayout>).detail);
    window.addEventListener('noor-home-layout', on);
    return () => window.removeEventListener('noor-home-layout', on);
  }, []);
  return [layout, save];
}
