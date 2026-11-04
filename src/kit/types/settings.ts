import type { Anchor, ConflictPolicy, ExportOptions, OutputFormat, ResizeMode } from './engine';

export type Theme = 'light' | 'dark' | 'system';
export type DeviceDirection = 'system' | 'natural' | 'standard';

export interface Limits {
  maxDimension: number;
  maxMegapixels: number;
}

/** Mirror of `AppSettings` in src-tauri/src/settings.rs. */
export interface AppSettings {
  version: number;
  theme: Theme;
  defaultOutputDir: string | null;
  defaultOutputFormat: OutputFormat;
  defaultQuality: number;
  defaultWatermarkAnchor: Anchor;
  defaultWatermarkOpacity: number;
  defaultBackground: string;
  defaultAspectRatio: string;
  defaultResizeMode: ResizeMode;
  defaultSuffix: string;
  defaultConflict: ConflictPolicy;
  confirmOverwrite: boolean;
  includeSubfolders: boolean;
  rememberLastExport: boolean;
  lastExport: Record<string, ExportOptions>;
  limits: Limits;
  concurrency: number;
  scrolling: { mouse: DeviceDirection; trackpad: DeviceDirection };
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  theme: 'system',
  defaultOutputDir: null,
  defaultOutputFormat: 'source',
  defaultQuality: 85,
  defaultWatermarkAnchor: 'bottomRight',
  defaultWatermarkOpacity: 0.8,
  defaultBackground: '#ffffff',
  defaultAspectRatio: 'free',
  defaultResizeMode: 'fit',
  defaultSuffix: '',
  defaultConflict: 'rename',
  confirmOverwrite: true,
  includeSubfolders: false,
  rememberLastExport: true,
  lastExport: {},
  limits: { maxDimension: 30000, maxMegapixels: 150 },
  concurrency: 2,
  scrolling: { mouse: 'system', trackpad: 'system' },
};

export interface AppInfo {
  name: string;
  version: string;
  identifier: string;
  arch: string;
  os: string;
  settingsPath: string;
}

export interface ScrollStatus {
  supported: boolean;
  macosVersion: string | null;
  storedNatural: boolean | null;
  explicitlySet: boolean;
  pendingRelogin: boolean;
  effectiveNatural: boolean | null;
  accessibilityTrusted: boolean;
  overrideActive: boolean;
  overrideError: string | null;
  mouse: DeviceDirection;
  trackpad: DeviceDirection;
  runningFromBundle: boolean;
  permissionApp: string;
  stats: ScrollStats;
}

export interface ScrollStats {
  mouseEvents: number;
  mouseReversed: number;
  trackpadEvents: number;
  trackpadReversed: number;
  reverseMouse: boolean;
  reverseTrackpad: boolean;
}

export interface ScrollOpResult {
  ok: boolean;
  message: string;
  status: ScrollStatus;
}
