import { useEffect, useState } from 'react';
import { planOperations } from '../services/image-processing';
import { AppError } from '../services/ipc';
import type { Operation, PipelinePlan } from '../types/engine';

/** Output dimensions computed by the engine from source dimensions alone (no decoding). */
export function usePlan(width: number | undefined, height: number | undefined, operations: Operation[]) {
  const [plan, setPlan] = useState<PipelinePlan | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const key = JSON.stringify(operations);
  useEffect(() => {
    if (!width || !height) {
      setPlan(null);
      setError(null);
      return;
    }
    let live = true;
    planOperations(width, height, JSON.parse(key) as Operation[])
      .then((p) => {
        if (!live) return;
        setPlan(p);
        setError(null);
      })
      .catch((e) => {
        if (!live) return;
        setPlan(null);
        setError(AppError.from(e));
      });
    return () => {
      live = false;
    };
  }, [width, height, key]);
  return { plan, error };
}
