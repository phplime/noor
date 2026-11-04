import { call, isTauri } from '../ipc';
import { DEFAULT_SETTINGS, type AppInfo, type AppSettings } from '../../types/settings';

export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri()) return { ...DEFAULT_SETTINGS };
  const s = await call<AppSettings>('get_settings');
  return { ...DEFAULT_SETTINGS, ...s };
}

/** Saves and returns the validated settings as stored by the backend. */
export function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return call<AppSettings>('save_settings', { settings });
}

export function resetSettings(): Promise<AppSettings> {
  return call<AppSettings>('reset_settings');
}

export function getAppInfo(): Promise<AppInfo> {
  return call<AppInfo>('app_info');
}
