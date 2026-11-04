import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import { errorText } from './ipc';

// ----- types (mirror crates/nexa-widgets and src-tauri/src/media.rs) -----

export type Module = 'music' | 'timer' | 'clock' | 'water' | 'todo' | 'shelf' | 'clipboard' | 'apps' | 'prayer' | 'iphone';
export type Panel = Module | 'settings';

export const MODULE_TITLES: Record<Panel, string> = {
  music: 'Now Playing',
  timer: 'Timer',
  clock: 'World Clock',
  water: 'Water',
  todo: 'To-do',
  shelf: 'Shelf',
  clipboard: 'Clipboard',
  apps: 'Quick Apps',
  prayer: 'Prayer Times',
  iphone: 'iPhone ⇄ Mac',
  settings: 'Settings',
};

export type WaterReminderMode = 'interval' | 'times' | 'smart';

export interface WaterSettings {
  goalMl: number;
  glassMl: number;
  reminders: boolean;
  mode: WaterReminderMode;
  remindEveryMin: number;
  times: string[];
  minGapMin: number;
  start: string;
  end: string;
}

export interface IslandSettings {
  modules: Module[];
  defaultModule: Module | null;
  expandOnHover: boolean;
  compactMusic: boolean;
  clipboardHistory: boolean;
  clipboardMaxItems: number;
  musicLyrics: boolean;
  use24Hour: boolean;
  water: WaterSettings;
  iphoneFolder: string | null;
  iphoneToShelf: boolean;
  lastModule: Module | null;
  seenModules?: Module[];
}

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
  doneAt: number | null;
  position: number;
}

export interface ClipItem {
  id: number;
  text: string;
  createdAt: number;
  pinned: boolean;
}

export interface WaterToday {
  date: string;
  totalMl: number;
  goalMl: number;
  entries: { id: number; ml: number; at: number }[];
  week: [string, number][];
}

export interface ShelfItem {
  id: string;
  path: string;
  name: string;
  ext: string;
  size: number;
  isDir: boolean;
  addedAt: number;
  exists: boolean;
}

export interface AppEntry {
  name: string;
  path: string;
}

export interface ClockNow {
  clock: { id: string; label: string; timezone: string; position: number };
  utcOffsetMin: number;
  diffMin: number;
}

export interface TimerState {
  label: string;
  durationMs: number;
  endsAt: number | null;
  pausedRemaining: number | null;
  notified: boolean;
}

export interface StopwatchState {
  startedAt: number | null;
  accumulatedMs: number;
  laps: number[];
}

export interface NowPlaying {
  active: boolean;
  player: 'spotify' | 'music' | null;
  playerLabel: string;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  positionMs: number;
  trackId: string;
  artwork: string | null;
  sampledAt: number;
}

export interface VolumeState {
  level: number | null;
  muted: boolean;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface Lyrics {
  synced: LyricLine[];
  plain: string | null;
  instrumental: boolean;
  found: boolean;
}

export interface OutFile {
  id: string;
  name: string;
  path: string;
  size: number;
  isImage: boolean;
  downloads: number;
}

export interface ReceiverInfo {
  running: boolean;
  url: string;
  qrSvg: string;
  folder: string;
  received: number;
  outbox: OutFile[];
  sent: number;
}

export interface Thumb {
  dataUrl: string;
  path: string;
}

// ----- commands -----

export const w = {
  settings: () => invoke<IslandSettings>('island_settings'),
  saveSettings: (settings: IslandSettings) => invoke<IslandSettings>('save_island_settings', { settings }),
  setLastModule: (module: Module) => invoke<void>('set_last_module', { module }),
  openModule: (module: string) => invoke<void>('island_open_module', { module }),

  todos: () => invoke<Todo[]>('todo_list'),
  todoAdd: (title: string) => invoke<Todo>('todo_add', { title }),
  todoDone: (id: string, done: boolean) => invoke<void>('todo_set_done', { id, done }),
  todoRename: (id: string, title: string) => invoke<void>('todo_rename', { id, title }),
  todoDelete: (id: string) => invoke<void>('todo_delete', { id }),
  todoClearDone: () => invoke<number>('todo_clear_done'),

  clips: (query?: string) => invoke<ClipItem[]>('clip_list', { query }),
  clipCopy: (id: number) => invoke<void>('clip_copy', { id }),
  clipPin: (id: number, pinned: boolean) => invoke<void>('clip_pin', { id, pinned }),
  clipDelete: (id: number) => invoke<void>('clip_delete', { id }),
  clipClear: () => invoke<number>('clip_clear'),

  water: () => invoke<WaterToday>('water_today'),
  waterAdd: (ml: number) => invoke<void>('water_add', { ml }),
  waterUndo: () => invoke<void>('water_undo'),

  shelf: () => invoke<ShelfItem[]>('shelf_list'),
  shelfRemove: (id: string) => invoke<void>('shelf_remove', { id }),
  shelfClear: () => invoke<void>('shelf_clear'),
  shelfOpen: (id: string) => invoke<void>('shelf_open', { id }),
  shelfReveal: (id: string) => invoke<void>('shelf_reveal', { id }),
  shelfThumb: (id: string) => invoke<Thumb | null>('shelf_thumb', { id }),
  shelfDragIcon: (id: string) => invoke<string>('shelf_drag_icon', { id }),

  appsInstalled: (refresh = false) => invoke<AppEntry[]>('apps_installed', { refresh }),
  appsPinned: () => invoke<AppEntry[]>('apps_pinned'),
  appPin: (entry: AppEntry) => invoke<void>('app_pin', { entry }),
  appUnpin: (path: string) => invoke<void>('app_unpin', { path }),
  appLaunch: (path: string) => invoke<void>('app_launch', { path }),
  appIcon: (path: string) => invoke<string | null>('app_icon', { path }),

  clocks: () => invoke<ClockNow[]>('clocks_list'),
  clockAdd: (label: string, timezone: string) => invoke<void>('clock_add', { label, timezone }),
  clockDelete: (id: string) => invoke<void>('clock_delete', { id }),

  timer: () => invoke<TimerState>('timer_get'),
  timerStart: (durationMs: number, label?: string) => invoke<TimerState>('timer_start', { durationMs, label }).then((t) => publish('timer', t)),
  timerAction: (action: 'pause' | 'resume' | 'add' | 'reset', ms?: number) =>
    invoke<TimerState>('timer_action', { action, ms }).then((t) => publish('timer', t)),
  stopwatch: () => invoke<StopwatchState>('stopwatch_get'),
  stopwatchAction: (action: 'start' | 'stop' | 'lap' | 'reset') =>
    invoke<StopwatchState>('stopwatch_action', { action }).then((s) => publish('stopwatch', s)),

  media: () => invoke<NowPlaying>('media_state'),
  mediaControl: (action: 'playPause' | 'next' | 'previous') => invoke<void>('media_control', { action }),
  mediaSeek: (seconds: number) => invoke<void>('media_seek', { seconds }),
  volume: () => invoke<VolumeState>('volume_get'),
  volumeSet: (level: number) => invoke<VolumeState>('volume_set', { level }),
  volumeMute: (muted: boolean) => invoke<VolumeState>('volume_mute', { muted }),
  lyrics: (np: NowPlaying) =>
    invoke<Lyrics>('lyrics_for', { artist: np.artist, title: np.title, album: np.album, durationMs: np.durationMs }),

  iphoneStart: () => invoke<ReceiverInfo>('iphone_start'),
  iphoneStop: () => invoke<void>('iphone_stop'),
  iphoneStatus: () => invoke<ReceiverInfo>('iphone_status'),
  iphoneOpenFolder: () => invoke<void>('iphone_open_folder'),
  iphoneShare: (paths: string[]) => invoke<ReceiverInfo>('iphone_share', { paths }),
  iphoneShareShelf: (ids: string[]) => invoke<ReceiverInfo>('iphone_share_shelf', { ids }),
  iphoneUnshare: (id: string) => invoke<ReceiverInfo>('iphone_unshare', { id }),
  iphoneClearOutbox: () => invoke<ReceiverInfo>('iphone_clear_outbox'),
  keepOpen: (keep: boolean) => invoke<void>('island_keep_open', { keep }),
};

/**
 * Load data and reload it whenever the backend reports a change for `module`
 * (`widgets://changed`). Returns [data, reload, error].
 */
/**
 * Hand a fresh result straight to every screen showing `module` (the timer page
 * and the mini timer bar), so buttons react at once instead of waiting for the
 * backend's change event.
 */
export function publish<T>(module: string, data: T): T {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('noor:widget', { detail: { module, data } }));
  return data;
}

export function useWidgetData<T>(module: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);
  useEffect(() => {
    void reload();
    const un = listen<string>('widgets://changed', (e) => {
      if (e.payload === module) void reload();
    });
    const onLocal = (e: Event) => {
      const d = (e as CustomEvent<{ module: string; data: T }>).detail;
      if (d?.module === module && d.data != null) setData(d.data);
    };
    window.addEventListener('noor:widget', onLocal);
    return () => {
      window.removeEventListener('noor:widget', onLocal);
      void un.then((f) => f());
    };
  }, [module, reload]);
  return { data, reload, error, setData };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatMs(ms: number, withHours = false): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 || withHours ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

/** Current playback position, extrapolated from the last sample. */
export function livePosition(np: NowPlaying, now: number): number {
  if (!np.active) return 0;
  const pos = np.playing ? np.positionMs + (now - np.sampledAt) : np.positionMs;
  return Math.min(Math.max(0, pos), np.durationMs || pos);
}

/** Set while a native dialog is open so the island doesn't collapse behind it. */
export const keepOpenRef = { current: false };

export async function withIslandKeptOpen<T>(fn: () => Promise<T>): Promise<T> {
  keepOpenRef.current = true;
  await w.keepOpen(true).catch(() => {});
  try {
    return await fn();
  } finally {
    // Give macOS a moment to return focus before blur handling resumes.
    window.setTimeout(() => {
      keepOpenRef.current = false;
      void w.keepOpen(false).catch(() => {});
    }, 400);
  }
}

export interface IslandAlert {
  kind: 'water' | 'timer' | 'prayer' | 'iphone' | string;
  title: string;
  body: string;
  at: number;
}
