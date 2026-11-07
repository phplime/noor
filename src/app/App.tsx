import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAction } from '@tauri-apps/plugin-notification';
import { AppProvider, useApp } from '../kit/app/AppContext';
import { KitOverlays, ToolScreen } from '../kit/layouts/AppLayout';
import { usePrayerSnapshot } from '../island/lib/hooks';
import { noor, type Permission } from './api';
import { Ctx, PRAYER_TABS, type NoorCtx, type PrayerTab, type Pushed, type RoutineTab, type Tab } from './context';
import { NIcon, type NoorIconName } from './icons';
import { HomeScreen } from './screens/Home';
import { Guard } from './Guard';
import { calmEnabled } from './optimize';
import { LiveIsland } from './LiveIsland';
import { useNoorTheme } from './theme';
import { useLiveActivity } from './live';
import { onAccent, resolveAccent } from './accent';

// Startup speed: only Home is in the first bundle. Every other screen loads on demand,
// and all of them are fetched quietly once Home is on screen so switching stays instant.
const CalendarScreen = lazy(() => import('./screens/Calendar').then((m) => ({ default: m.CalendarScreen })));
const RamadanPage = lazy(() => import('./screens/Ramadan').then((m) => ({ default: m.RamadanPage })));
const CalendarSettingsPage = lazy(() =>
  import('./screens/CalendarSettings').then((m) => ({
    default: m.CalendarSettingsPage,
  })),
);
const PrayerScreen = lazy(() => import('./screens/Prayer').then((m) => ({ default: m.PrayerScreen })));
const RoutineScreen = lazy(() => import('./screens/Routine').then((m) => ({ default: m.RoutineScreen })));
const ToolsScreen = lazy(() => import('./screens/Tools').then((m) => ({ default: m.ToolsScreen })));
const SettingsPage = lazy(() => import('./screens/Settings').then((m) => ({ default: m.SettingsPage })));
const PrayerSettingsPage = lazy(() =>
  import('./screens/PrayerSettings').then((m) => ({
    default: m.PrayerSettingsPage,
  })),
);
const UpcomingPage = lazy(() => import('./screens/Upcoming').then((m) => ({ default: m.UpcomingPage })));
const AboutPage = lazy(() => import('./screens/About').then((m) => ({ default: m.AboutPage })));
const OptimizePage = lazy(() => import('./screens/Optimize').then((m) => ({ default: m.OptimizePage })));
const VoicePage = lazy(() => import('./screens/VoicePage').then((m) => ({ default: m.VoicePage })));
const QuranPage = lazy(() => import('./screens/Quran').then((m) => ({ default: m.QuranPage })));
const Onboarding = lazy(() => import('./screens/Onboarding').then((m) => ({ default: m.Onboarding })));
const SCREENS: (() => Promise<unknown>)[] = [
  () => import('./screens/Calendar'),
  () => import('./screens/Ramadan'),
  () => import('./screens/CalendarSettings'),
  () => import('./screens/Prayer'),
  () => import('./screens/Routine'),
  () => import('./screens/Tools'),
  () => import('./screens/Settings'),
  () => import('./screens/PrayerSettings'),
  () => import('./screens/Upcoming'),
  () => import('./screens/About'),
  () => import('./screens/Optimize'),
  () => import('./screens/VoicePage'),
  () => import('./screens/Quran'),
  () => import('./screens/Onboarding'),
];
let prefetched = false;
function prefetchScreens() {
  if (prefetched) return;
  prefetched = true;
  const run = () => SCREENS.forEach((load) => void load().catch(() => undefined));
  const ric = (
    window as unknown as {
      requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void;
    }
  ).requestIdleCallback;
  if (ric) ric(run, { timeout: 2500 });
  else window.setTimeout(run, 1200);
}

// Prayer sits in the middle as the raised button.
const TABS: { id: Tab; label: string; icon: NoorIconName; center?: boolean }[] = [
  { id: 'today', label: 'Home', icon: 'home' },
  { id: 'calendar', label: 'Calendar', icon: 'calendarStar' },
  { id: 'prayer', label: 'Prayer', icon: 'moonStar', center: true },
  { id: 'routine', label: 'Daily Life', icon: 'routine' },
  { id: 'tools', label: 'Studio', icon: 'tools' },
];

const ONBOARD_KEY = 'noor.onboarded.v1';

function readOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARD_KEY) === '1';
  } catch {
    return false;
  }
}

function Shell() {
  const { snapshot, error, reload } = usePrayerSnapshot();
  const { choice: theme, setChoice: setTheme, scheme, glass } = useNoorTheme();
  const kit = useApp();

  // MacKit's tools follow Noor's light/dark scheme.
  useEffect(() => {
    if (kit.settingsLoaded && kit.settings.theme !== scheme) void kit.updateSettings({ theme: scheme });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme, kit.settingsLoaded]);
  const [tab, setTab] = useState<Tab>('today');
  const [routineTab, setRoutineTab] = useState<RoutineTab>('reminders');
  const [prayerTab, setPrayerTab] = useState<PrayerTab>('prayer');
  const [stack, setStack] = useState<Pushed[]>([]);
  const [permission, setPermission] = useState<Permission | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(readOnboarded);
  const toastTimer = useRef<number | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);

  const flash = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const go = useCallback((t: Tab, sub?: RoutineTab | PrayerTab) => {
    setStack([]);
    if (sub && (PRAYER_TABS as readonly string[]).includes(sub)) {
      setTab('prayer');
      setPrayerTab(sub as PrayerTab);
    } else {
      setTab(t);
      if (sub) setRoutineTab(sub as RoutineTab);
    }
    scroller.current?.scrollTo({ top: 0 });
  }, []);

  const push = useCallback((p: Pushed) => setStack((s) => [...s, p]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  const askPermission = useCallback(async () => {
    const p = await noor.permission(true).catch(() => 'prompt' as Permission);
    setPermission(p);
    return p;
  }, []);

  // Permission status + re-plan notifications on launch and whenever Noor returns to the foreground.
  useEffect(() => {
    const sync = () => {
      void noor
        .permission(false)
        .then(setPermission)
        .catch(() => undefined);
      void noor.refresh().catch(() => undefined);
    };
    sync();
    const onVis = () => !document.hidden && sync();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Battery: freeze decorative animations after 8 s without a touch; any touch or scroll wakes them.
  useEffect(() => {
    const root = document.documentElement;
    let t: number | undefined;
    const wake = () => {
      window.clearTimeout(t);
      // Calm mode (Settings › Optimize): animations stay still all the time.
      if (calmEnabled()) return void root.classList.add('n-still');
      root.classList.remove('n-still');
      t = window.setTimeout(() => root.classList.add('n-still'), 8_000);
    };
    const opts = { passive: true, capture: true } as const;
    wake();
    window.addEventListener('pointerdown', wake, opts);
    window.addEventListener('scroll', wake, opts);
    window.addEventListener('keydown', wake, opts);
    window.addEventListener('noor:calm', wake);
    return () => {
      window.removeEventListener('noor:calm', wake);
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', wake, opts);
      window.removeEventListener('scroll', wake, opts);
      window.removeEventListener('keydown', wake, opts);
    };
  }, []);

  // Lock-screen prayer Live Activity (iPhone).
  useLiveActivity(snapshot);
  useEffect(() => {
    if (snapshot) prefetchScreens();
  }, [snapshot]);

  // Tapping a notification opens the matching screen.
  useEffect(() => {
    const route = (r: string | undefined) => {
      if (!r) return;
      if (r.startsWith('prayer')) go('prayer', 'prayer');
      else if (r === 'water') go('routine', 'water');
      else if (r === 'timer') go('routine', 'timer');
      else if (r.startsWith('reminder')) go('routine', 'reminders');
      else if (r === 'calendar') go('calendar');
      else if (r === 'cycle') go('routine', 'cycle');
      else if (r === 'duas') go('routine', 'dua');
      else if (r === 'fitness') go('routine', 'fitness');
      else if (r.startsWith('quran')) {
        go('today');
        push({ kind: 'quran', surah: Number(r.split(':')[1]) || undefined });
      } else if (r === 'ramadan') {
        go('today');
        push({ kind: 'ramadan' });
      } else go('today');
    };
    let unlisten: (() => void) | undefined;
    onAction((e: unknown) => {
      const ev = e as {
        notification?: { extra?: Record<string, string> };
        extra?: Record<string, string>;
      };
      route(ev?.notification?.extra?.route ?? ev?.extra?.route);
    })
      .then((l) => {
        unlisten = () => void l.unregister();
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [go, push]);

  // Accent colour from the prayer display settings, set on <html> so sheets (portals) share it.
  const accent = resolveAccent(snapshot?.settings.display.accent);
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty('--n-accent', accent);
    el.style.setProperty('--n-on-accent', onAccent(accent));
  }, [accent]);

  const ctx = useMemo<NoorCtx>(
    () => ({
      snapshot,
      prayerError: error,
      reloadPrayer: reload,
      tab,
      routineTab,
      prayerTab,
      setPrayerTab,
      go,
      push,
      permission,
      askPermission,
      theme,
      scheme,
      setTheme,
      flash,
    }),
    [
      snapshot,
      error,
      reload,
      tab,
      routineTab,
      prayerTab,
      go,
      push,
      permission,
      askPermission,
      theme,
      scheme,
      setTheme,
      flash,
    ],
  );

  const top = stack[stack.length - 1];

  return (
    <Ctx.Provider value={ctx}>
      <div className="n-app">
        {glass && (
          <div className="n-bg" aria-hidden="true">
            <span className="n-bg__a" />
            <span className="n-bg__b" />
          </div>
        )}

        <div className={`n-tabs-host ${top ? 'is-covered' : ''}`}>
          <div className="n-statusfade" aria-hidden="true" />
          <div className="n-scroll" ref={scroller}>
            <Guard name={`tab:${tab}`} resetKey={`${tab}:${routineTab}`}>
              <Suspense fallback={<div className="n-lazy" />}>
                {tab === 'today' && <HomeScreen />}
                {tab === 'prayer' && <PrayerScreen />}
                {tab === 'calendar' && <CalendarScreen />}
                {tab === 'routine' && <RoutineScreen tab={routineTab} onTab={setRoutineTab} />}
                {tab === 'tools' && <ToolsScreen />}
              </Suspense>
            </Guard>
          </div>
          <div className="n-island-fade" aria-hidden="true" />
          <LiveIsland />
          <nav className="n-island" aria-label="Main">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`n-island__item ${tab === t.id ? 'is-on' : ''} ${t.center ? 'is-center' : ''}`}
                onClick={() => go(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                aria-label={t.label}
              >
                {t.center ? (
                  <span className="n-island__fab">
                    <NIcon name={t.icon} size={27} stroke={2.1} />
                  </span>
                ) : (
                  <NIcon name={t.icon} size={23} stroke={tab === t.id ? 2.2 : 1.8} />
                )}
                <span className="n-island__label">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {top && (
          <div className="n-pushed" key={stack.length}>
            <Guard name={`page:${top.kind}`} resetKey={stack.length} onBack={pop}>
              <Suspense fallback={<div className="n-lazy" />}>
                {top.kind === 'tool' && (
                  <div className="kit-scope n-kit">
                    <ToolScreen toolId={top.id} onBack={pop} />
                  </div>
                )}
                {top.kind === 'prayer-settings' && <PrayerSettingsPage section={top.section} onBack={pop} />}
                {top.kind === 'upcoming' && <UpcomingPage onBack={pop} />}
                {top.kind === 'settings' && <SettingsPage onBack={pop} />}
                {top.kind === 'ramadan' && <RamadanPage onBack={pop} />}
                {top.kind === 'calendar-settings' && <CalendarSettingsPage onBack={pop} />}
                {top.kind === 'about' && <AboutPage onBack={pop} />}
                {top.kind === 'optimize' && <OptimizePage onBack={pop} />}
                {top.kind === 'voice' && <VoicePage onBack={pop} />}
                {top.kind === 'quran' && (
                  <QuranPage key={`${top.surah}:${top.ayah}`} surah={top.surah} ayah={top.ayah} onBack={pop} />
                )}
              </Suspense>
            </Guard>
          </div>
        )}

        {toast && <div className="n-toast">{toast}</div>}

        {!onboarded && (
          <Suspense fallback={null}>
            <Onboarding
              onDone={() => {
                try {
                  localStorage.setItem(ONBOARD_KEY, '1');
                } catch {
                  /* ignore */
                }
                setOnboarded(true);
              }}
            />
          </Suspense>
        )}

        <div className="kit-scope n-kit-overlays">
          <KitOverlays />
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function NoorApp() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
