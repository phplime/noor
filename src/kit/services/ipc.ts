import { invoke } from '@tauri-apps/api/core';
import type { EngineError } from '../types/engine';

/** True when running inside the Tauri shell (false in a plain browser tab). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const NO_RUNTIME_MESSAGE =
  'This is a browser tab, not the MacKit app, so it cannot open files. Close this tab and use the MacKit window that `npm run app:dev` opens.';

/** Normalised error thrown by every service call. */
export class AppError extends Error {
  readonly code: string;
  readonly details?: Record<string, number>;

  constructor(code: string, message: string, details?: Record<string, number>) {
    super(message);
    this.code = code;
    this.details = details;
  }

  static from(e: unknown): AppError {
    if (e instanceof AppError) return e;
    // Tauri plugins (dialogs, opener…) fail with a TypeError in a plain browser tab.
    if (!isTauri() && e instanceof TypeError && /invoke|__TAURI/.test(e.message)) return new AppError('no_runtime', NO_RUNTIME_MESSAGE);
    if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
      const err = e as EngineError;
      return new AppError(err.code, err.message, err.details);
    }
    if (typeof e === 'string') return new AppError('error', e);
    if (e instanceof Error) return new AppError('error', e.message);
    return new AppError('error', 'An unknown error occurred');
  }
}

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new AppError('no_runtime', NO_RUNTIME_MESSAGE);
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw AppError.from(e);
  }
}
