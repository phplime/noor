import { invoke } from '@tauri-apps/api/core';

/** Settings › Optimize (iPhone). */

export interface DeviceHealth {
  battery?: number | null;
  charging?: 'charging' | 'full' | 'unplugged' | 'unknown';
  lowPower?: boolean;
  thermal?: 'nominal' | 'fair' | 'serious' | 'critical';
  free?: number;
  total?: number;
}

export interface JunkFile {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export interface JunkGroup {
  id: string;
  label: string;
  detail: string;
  safe: boolean;
  files: JunkFile[];
}

export interface PhotoItem {
  id: string;
  size: number;
  w: number;
  h: number;
  duration: number;
  date?: string;
  thumb?: string;
}

export interface PhotoScan {
  error?: string;
  screenshots?: PhotoItem[];
  videos?: PhotoItem[];
  duplicates?: PhotoItem[][];
  scanned?: number;
  limited?: boolean;
}

export const optimize = {
  device: () => invoke<DeviceHealth>('optimize_device'),
  junkScan: () => invoke<JunkGroup[]>('optimize_junk_scan'),
  junkClean: (paths: string[]) => invoke<number>('optimize_junk_clean', { paths }),
  /** One part at a time so the screen can show real progress. */
  photosScan: (part: 'screenshots' | 'videos' | 'duplicates') => invoke<PhotoScan>('optimize_photos_scan', { part }),
  /** "ok" | "cancelled" | error text */
  photosDelete: (ids: string[]) => invoke<string>('optimize_photos_delete', { ids }),
};

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export const thumbSrc = (t?: string) => (!t ? undefined : t.startsWith('data:') ? t : `data:image/jpeg;base64,${t}`);

// ---- "Calm mode": keep decorative animations frozen all the time ----

const CALM_KEY = 'noor.calm.v1';

export function calmEnabled(): boolean {
  try {
    return localStorage.getItem(CALM_KEY) === '1';
  } catch {
    return false;
  }
}

export function setCalmEnabled(on: boolean) {
  try {
    localStorage.setItem(CALM_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event('noor:calm'));
}

/**
 * Of a duplicate group, the photo to keep: the one with the most pixels, then the largest file.
 */
export function bestOf(group: PhotoItem[]): string {
  return [...group].sort((a, b) => b.w * b.h - a.w * a.h || b.size - a.size)[0]?.id ?? '';
}
