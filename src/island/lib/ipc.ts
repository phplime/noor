import { invoke } from '@tauri-apps/api/core';
import { openAppSettings, playSound } from '../../app/sound';
import { PRAYER_NAMES } from './types';
import type {
  City,
  DailyPrayerSchedule,
  IslandInfo,
  IslandMode,
  LocationMode,
  ManualTimetable,
  PlannedReminder,
  Prayer,
  PrayerCalculationSettings,
  PrayerDisplaySettings,
  PrayerLocation,
  PrayerNotificationSettings,
  PrayerReminder,
  PrayerSnapshot,
} from './types';

/** Typed wrappers around the Rust commands in src-tauri/src/commands.rs. */
export const api = {
  snapshot: () => invoke<PrayerSnapshot>('prayer_snapshot'),
  schedule: (date: string) => invoke<DailyPrayerSchedule>('prayer_schedule', { date }),
  month: (year: number, month: number) => invoke<DailyPrayerSchedule[]>('prayer_month', { year, month }),
  upcoming: (hours = 48, limit = 100) => invoke<PlannedReminder[]>('prayer_upcoming', { hours, limit }),

  saveCalculation: (settings: PrayerCalculationSettings) =>
    invoke<PrayerCalculationSettings>('save_calculation', { settings }),
  saveManual: (manual: ManualTimetable) => invoke<ManualTimetable>('save_manual', { manual }),
  saveDisplay: (display: PrayerDisplaySettings) => invoke<PrayerDisplaySettings>('save_display', { display }),
  saveNotifications: (notifications: PrayerNotificationSettings) =>
    invoke<PrayerNotificationSettings>('save_notifications', { notifications }),
  adjustPrayer: (
    prayer: Prayer,
    change: { kind: 'offset'; minutes: number } | { kind: 'fixed'; time: string } | { kind: 'reset' },
  ) => invoke<unknown>('prayer_adjust', { prayer, change }),
  newReminder: (prayer: Prayer, offsetMinutes: number) =>
    invoke<PrayerReminder>('new_reminder', { prayer, offsetMinutes }),

  searchLocations: (query: string) => invoke<City[]>('location_search', { query }),
  saveLocation: (location: PrayerLocation, makeActive: boolean) =>
    invoke<PrayerLocation>('location_save', { location, makeActive }),
  deleteLocation: (id: string) => invoke<void>('location_delete', { id }),
  setActiveLocation: (id: string) => invoke<void>('location_set_active', { id }),
  setDeviceLocation: (latitude: number, longitude: number) =>
    invoke<PrayerLocation>('location_set_device', { latitude, longitude }),
  setLocationMode: (mode: LocationMode) => invoke<void>('location_set_mode', { mode }),
  timezones: () => invoke<{ system: string; all: string[] }>('timezones'),

  // Noor (iOS): a real scheduled notification a few seconds from now, in-app sound preview,
  // and the app's page in the iOS Settings app.
  testNotification: (prayer?: Prayer, sound?: string) =>
    invoke<void>('notify_test', {
      title: `Prayer Reminder — ${prayer ? PRAYER_NAMES[prayer] : 'Asr'}`,
      body: 'This is a test. Your prayer reminders will look and sound like this.',
      sound,
      delaySecs: 5,
    }),
  previewSound: async (sound: string) => playSound(sound),
  openSystemSettings: async (_kind: 'notifications' | 'location' | 'focus') => openAppSettings(),

  islandInfo: () => invoke<IslandInfo>('island_info'),
  setIslandMode: (mode: IslandMode) => invoke<void>('island_set_mode', { mode }),
  openCenter: (section?: string) => invoke<void>('open_center', { section }),
  hideCenter: () => invoke<void>('hide_center'),
  autostartStatus: () => invoke<boolean>('autostart_status'),
  setAutostart: (enabled: boolean) => invoke<boolean>('autostart_set', { enabled }),
  quit: () => invoke<void>('quit_app'),
};

export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
