import { useCallback, useRef, useState } from 'react';

/**
 * State with Undo and Reset. Rapid successive changes (typing, dragging) are
 * grouped into a single undo step.
 */
export function useUndoable<T>(initial: T, groupMs = 600) {
  const [value, setValue] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const lastPush = useRef(0);
  const initialRef = useRef(initial);
  const [, force] = useState(0);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (v === prev) return prev;
        const now = Date.now();
        if (now - lastPush.current > groupMs) {
          past.current = [...past.current.slice(-49), prev];
          force((n) => n + 1);
        }
        lastPush.current = now;
        return v;
      });
    },
    [groupMs],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev !== undefined) {
      lastPush.current = 0;
      setValue(prev);
      force((n) => n + 1);
    }
  }, []);

  const reset = useCallback((to?: T) => {
    const target = to ?? initialRef.current;
    setValue((cur) => {
      if (cur !== target) past.current = [...past.current.slice(-49), cur];
      return target;
    });
    if (to !== undefined) initialRef.current = to;
    lastPush.current = 0;
    force((n) => n + 1);
  }, []);

  /** Replace without recording history (e.g. when a new image is loaded). */
  const replace = useCallback((v: T, asInitial = false) => {
    past.current = [];
    if (asInitial) initialRef.current = v;
    setValue(v);
    force((n) => n + 1);
  }, []);

  return { value, set, undo, reset, replace, canUndo: past.current.length > 0 };
}
