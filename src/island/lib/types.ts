// Mirrors the Rust models in crates/nexa-prayer/src/models.rs (serde camelCase).

export type Prayer = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export const ALL_PRAYERS: Prayer[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

export const PRAYER_NAMES: Record<Prayer, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

export type LocationSource = 'search' | 'manual' | 'device';

export interface PrayerLocation {
  id: string;
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  elevation: number;
  source: LocationSource;
}

export type CalculationMethod =
  | 'muslimWorldLeague'
  | 'isna'
  | 'egypt'
  | 'ummAlQura'
  | 'karachi'
  | 'dubai'
  | 'kuwait'
  | 'qatar'
  | 'singapore'
  | 'turkey'
  | 'tehran'
  | 'custom';

export type AsrMethod = 'standard' | 'hanafi';
export type HighLatitudeRule = 'middleOfNight' | 'seventhOfNight' | 'twilightAngle' | 'none';
export type TimetableMode = 'calculated' | 'manual';

export type PrayerOffsets = Record<Prayer, number>;

export interface PrayerCalculationSettings {
  method: CalculationMethod;
  asr: AsrMethod;
  highLatitude: HighLatitudeRule;
  customFajrAngle: number;
  customIshaAngle: number;
  customIshaMinutes: number | null;
  offsets: PrayerOffsets;
  mode: TimetableMode;
}

export type ManualTimetable = Partial<Record<Prayer, string | null>>;

export interface PrayerTimeEntry {
  prayer: Prayer;
  time: string;
  calculatedTime: string | null;
  offsetMinutes: number;
  source: 'calculated' | 'manual';
  highLatitudeAdjusted: boolean;
  /** The mosque's jamaat time, if set; `time` is when the prayer starts. */
  jamaat?: string | null;
}

export interface DailyPrayerSchedule {
  date: string;
  locationId: string;
  locationName: string;
  timezone: string;
  method: CalculationMethod;
  asr: AsrMethod;
  entries: PrayerTimeEntry[];
}

export interface NextPrayer {
  prayer: Prayer;
  time: string;
  date: string;
  secondsRemaining: number;
}

export interface PrayerReminder {
  id: string;
  prayer: Prayer;
  /** Negative = before, 0 = at prayer time, positive = after. */
  offsetMinutes: number;
  enabled: boolean;
  title: string | null;
  message: string | null;
  sound: string | null;
}

export interface PrayerNotificationConfig {
  prayer: Prayer;
  enabled: boolean;
  reminders: PrayerReminder[];
}

export interface PrayerNotificationSettings {
  masterEnabled: boolean;
  defaultSound: string;
  graceMinutes: number;
  prayers: PrayerNotificationConfig[];
  /** Alerts before and at jamaat for prayers with a jamaat time. */
  jamaatAlerts?: boolean;
  jamaatBeforeMinutes?: number;
}

export interface PrayerDisplaySettings {
  showNextInCompact: boolean;
  showCountdown: boolean;
  highlightUpcoming: boolean;
  showSunrise: boolean;
  prePrayerCountdownMinutes: number;
  use24Hour: boolean;
  cardStyle: 'comfortable' | 'compact';
  accent: string;
  expandOnNotificationClick: boolean;
}

export type LocationMode = 'saved' | 'automatic';

export interface PrayerSettings {
  calculation: PrayerCalculationSettings;
  manual: ManualTimetable;
  notifications: PrayerNotificationSettings;
  display: PrayerDisplaySettings;
  locationMode: LocationMode;
  activeLocationId: string;
}

export interface MethodInfo {
  id: CalculationMethod;
  name: string;
  description: string;
}

export interface PrayerSnapshot {
  settings: PrayerSettings;
  locations: PrayerLocation[];
  activeLocation: PrayerLocation;
  today: DailyPrayerSchedule;
  tomorrow: DailyPrayerSchedule;
  next: NextPrayer | null;
  methods: MethodInfo[];
  now: string;
}

export interface PlannedReminder {
  id: string;
  reminderId: string;
  prayer: Prayer;
  date: string;
  prayerTime: string;
  fireAt: string;
  offsetMinutes: number;
  title: string;
  body: string;
  sound: string;
}

export interface City {
  name: string;
  region: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  population: number;
  timezone: string;
}

export type IslandMode = 'compact' | 'expanded' | 'hidden';

export interface IslandInfo {
  mode: IslandMode;
  screen: { hasNotch: boolean; notchWidth: number; menuBarHeight: number };
}

/** Notification sounds bundled with Noor (public/sounds/<id>.wav). */
export const SOUNDS = [
  'default',
  'none',
  'noor_chime',
  'noor_dawn',
  'noor_bell',
  'noor_glass',
  'noor_soft',
  'noor_pop',
  'noor_timer',
] as const;

export const SOUND_LABELS: Record<string, string> = {
  default: 'Default (Noor Chime)',
  none: 'Silent',
  noor_chime: 'Noor Chime',
  noor_dawn: 'Dawn (long)',
  noor_bell: 'Bell',
  noor_glass: 'Glass',
  noor_soft: 'Soft Marimba',
  noor_pop: 'Pop',
  noor_timer: 'Timer',
};
