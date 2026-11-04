import { invoke } from '@tauri-apps/api/core';
import { isIOS } from '../kit/utils/platform';

/** Back up and restore everything Noor keeps on this device. */

export interface BackupInfo {
  path: string;
  fileName: string;
  bytes: number;
}

const LAST_KEY = 'noor.backup.last';

function localPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== LAST_KEY) out[k] = localStorage.getItem(k) ?? '';
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

export function lastBackup(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Make the backup file; on iPhone, open the share sheet so it can be saved to Files. */
export async function backupNow(): Promise<{ info: BackupInfo; shared: boolean }> {
  const info = await invoke<BackupInfo>('backup_export', { local: localPrefs() });
  let shared = false;
  if (isIOS()) {
    await invoke('share_files', { paths: [info.path] });
    shared = true;
  }
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  return { info, shared };
}

/** Quick look at a backup file before restoring it. */
export function peek(text: string): { createdAt: string; size: number } | null {
  try {
    const b = JSON.parse(text) as { format?: string; createdAt?: string };
    if (b.format !== 'noor-backup') return null;
    return { createdAt: b.createdAt ?? '', size: text.length };
  } catch {
    return null;
  }
}

/** Replace all data with the backup, then reload the app. */
export async function restore(text: string): Promise<void> {
  const local = await invoke<Record<string, string>>('backup_import', { json: text });
  try {
    const keep = localStorage.getItem(LAST_KEY);
    localStorage.clear();
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    if (keep) localStorage.setItem(LAST_KEY, keep);
  } catch {
    /* ignore */
  }
  window.location.reload();
}
