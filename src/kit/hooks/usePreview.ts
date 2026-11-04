import { useEffect, useRef, useState } from 'react';
import { renderPreview } from '../services/image-processing';
import { AppError } from '../services/ipc';
import type { Operation, PreviewResult } from '../types/engine';

/**
 * Live preview rendered by the real engine (same code path as export).
 * Requests are debounced and stale responses are discarded.
 */
export function usePreview(path: string | null, operations: Operation[], enabled = true, maxSide = 1400) {
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const key = JSON.stringify(operations);

  useEffect(() => {
    if (!path || !enabled) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      renderPreview(path, JSON.parse(key) as Operation[], maxSide)
        .then((r) => {
          if (id !== seq.current) return;
          setResult(r);
          setError(null);
        })
        .catch((e) => {
          if (id !== seq.current) return;
          setError(AppError.from(e));
        })
        .finally(() => {
          if (id === seq.current) setLoading(false);
        });
    }, 120);
    return () => window.clearTimeout(t);
  }, [path, key, enabled, maxSide]);

  // Clear the old image when switching files so we never show a stale preview.
  useEffect(() => {
    setResult(null);
  }, [path]);

  return { result, error, loading };
}
