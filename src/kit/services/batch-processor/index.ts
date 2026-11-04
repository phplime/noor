import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { call } from '../ipc';
import type { BatchEvent, BatchJob, BatchSummary, ItemUpdate } from '../../types/engine';

interface BatchEventPayload {
  jobId: string;
  event: BatchEvent;
}

export interface BatchCallbacks {
  onItem?: (u: ItemUpdate) => void;
  onFinished?: (s: BatchSummary) => void;
}

let counter = 0;
const newJobId = () => `job-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/**
 * Start a batch in the native backend. Processing happens on background
 * threads; progress is streamed back as events. Resolves with the summary.
 */
export async function runBatch(job: BatchJob, cb: BatchCallbacks = {}): Promise<{ jobId: string; done: Promise<BatchSummary> }> {
  const jobId = newJobId();
  let unlisten: UnlistenFn | null = null;
  let resolveDone!: (s: BatchSummary) => void;
  const done = new Promise<BatchSummary>((r) => (resolveDone = r));

  unlisten = await listen<BatchEventPayload>('batch-event', ({ payload }) => {
    if (payload.jobId !== jobId) return;
    const ev = payload.event;
    if (ev.kind === 'item') {
      const { kind: _k, ...update } = ev;
      cb.onItem?.(update);
    } else {
      const { kind: _k, ...summary } = ev;
      cb.onFinished?.(summary);
      unlisten?.();
      resolveDone(summary);
    }
  });

  try {
    await call<void>('start_batch', { jobId, job });
  } catch (e) {
    unlisten();
    throw e;
  }
  return { jobId, done };
}

export function cancelBatch(jobId: string): Promise<boolean> {
  return call<boolean>('cancel_batch', { jobId });
}
