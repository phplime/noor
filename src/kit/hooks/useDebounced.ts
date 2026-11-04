import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delay = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Simple undo history for a settings object. */
export function pushHistory<T>(history: T[], value: T, limit = 50): T[] {
  const last = history[history.length - 1];
  if (last !== undefined && JSON.stringify(last) === JSON.stringify(value)) return history;
  return [...history.slice(-(limit - 1)), value];
}
