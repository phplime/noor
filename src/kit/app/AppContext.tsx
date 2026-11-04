import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BRAND } from './brand';
import { getAppInfo, loadSettings, resetSettings as resetSettingsApi, saveSettings } from '../services/settings';
import { AppError } from '../services/ipc';
import { DEFAULT_SETTINGS, type AppInfo, type AppSettings } from '../types/settings';
import type { ExportOptions } from '../types/engine';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
  /** Several buttons (e.g. Save to Photos · Save to Files on iPhone). */
  actions?: { label: string; run: () => void }[];
}

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Extra buttons, e.g. "Rename" alongside "Replace". Resolves with its value. */
  extra?: { label: string; value: string }[];
}

interface ConfirmState extends ConfirmOptions {
  resolve: (v: string | false) => void;
}

interface AppContextValue {
  settings: AppSettings;
  settingsLoaded: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
  rememberExport: (toolId: string, opts: ExportOptions) => void;
  appInfo: AppInfo;
  toasts: Toast[];
  notify: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  /** Resolves to 'confirm', an extra button value, or false when cancelled. */
  confirm: (o: ConfirmOptions) => Promise<string | false>;
  confirmState: ConfirmState | null;
  resolvedTheme: 'light' | 'dark';
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

function useSystemDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setLoaded] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: BRAND.fallbackName,
    version: BRAND.fallbackVersion,
    identifier: '',
    arch: '',
    os: '',
    settingsPath: '',
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const nextId = useRef(1);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const notify = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    const ttl = t.kind === 'error' ? 9000 : t.actions?.length ? 12000 : t.action ? 8000 : 4500;
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), ttl);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch((e) => notify({ kind: 'error', title: 'Could not load settings', message: AppError.from(e).message }))
      .finally(() => setLoaded(true));
    getAppInfo()
      .then((info) => {
        setAppInfo(info);
        document.title = info.name;
      })
      .catch(() => undefined);
  }, [notify]);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      setSettings(next);
      try {
        setSettings(await saveSettings(next));
      } catch (e) {
        notify({ kind: 'error', title: 'Settings not saved', message: AppError.from(e).message });
      }
    },
    [notify],
  );

  const resetSettings = useCallback(async () => {
    try {
      setSettings(await resetSettingsApi());
      notify({ kind: 'success', title: 'Settings restored to defaults' });
    } catch (e) {
      notify({ kind: 'error', title: 'Could not reset settings', message: AppError.from(e).message });
    }
  }, [notify]);

  const rememberExport = useCallback(
    (toolId: string, opts: ExportOptions) => {
      const s = settingsRef.current;
      if (!s.rememberLastExport) return;
      void updateSettings({ lastExport: { ...s.lastExport, [toolId]: { ...opts, allowSourceOverwrite: false } } });
    },
    [updateSettings],
  );

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<string | false>((resolve) => {
        setConfirmState({
          ...o,
          resolve: (v) => {
            setConfirmState(null);
            resolve(v);
          },
        });
      }),
    [],
  );

  const systemDark = useSystemDark();
  const resolvedTheme: 'light' | 'dark' =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      settingsLoaded,
      updateSettings,
      resetSettings,
      rememberExport,
      appInfo,
      toasts,
      notify,
      dismiss,
      confirm,
      confirmState,
      resolvedTheme,
    }),
    [settings, settingsLoaded, updateSettings, resetSettings, rememberExport, appInfo, toasts, notify, dismiss, confirm, confirmState, resolvedTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
