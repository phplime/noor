import { useCallback, useEffect, useState } from 'react';

/** What the user picks. `glass` = frosted surfaces over a soft gradient, following the system's light/dark. */
export type ThemeChoice = 'system' | 'light' | 'dark' | 'glass';
export type Scheme = 'light' | 'dark';

const KEY = 'noor.theme';

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'glass' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

/**
 * Current theme choice + the resolved light/dark scheme. Writes
 * `data-scheme` and `data-glass` on <html> so sheets rendered in portals match.
 */
export function useNoorTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setSysDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const scheme: Scheme = choice === 'light' ? 'light' : choice === 'dark' ? 'dark' : sysDark ? 'dark' : 'light';
  const glass = choice === 'glass';

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.scheme = scheme;
    if (glass) el.dataset.glass = '';
    else delete el.dataset.glass;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', scheme === 'dark' ? '#0e0f12' : '#f3f4f6');
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', scheme);
  }, [scheme, glass]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* ignore */
    }
  }, []);

  return { choice, setChoice, scheme, glass };
}
