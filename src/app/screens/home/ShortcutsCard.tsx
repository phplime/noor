import { useEffect, useState } from 'react';
import { formatMs, w, type TimerState, type WaterToday } from '../../../island/lib/widgets';
import type { PrayerTab, RoutineTab } from '../../context';
import { NIcon } from '../../icons';
import { DHIKR, loadTasbih, rollDay, saveTasbih, tap, targetOf, type TasbihState } from '../../tasbih';
import { optimize, type DeviceHealth } from '../../optimize';
import { isIOS } from '../../../kit/utils/platform';

/** Three one-tap shortcuts at the top of Home: Tasbih, Water, Timer. */
export function ShortcutsCard({
  water,
  goal,
  glass,
  timer,
  now,
  onOpen,
  onOptimize,
}: {
  water: WaterToday | null;
  goal: number;
  glass: number;
  timer: TimerState | null;
  now: number;
  onOpen: (t: RoutineTab | PrayerTab) => void;
  /** Settings › Optimize (iPhone only). */
  onOptimize?: () => void;
}) {
  const showOpt = !!onOptimize && (isIOS() || !!import.meta.env.VITE_MOCK);
  const [dev, setDev] = useState<DeviceHealth | null>(null);
  useEffect(() => {
    if (showOpt) void optimize.device().then(setDev).catch(() => undefined);
  }, [showOpt]);
  const [t, setT] = useState<TasbihState>(() => rollDay(loadTasbih()));
  useEffect(() => {
    const on = () => setT(rollDay(loadTasbih()));
    window.addEventListener('focus', on);
    document.addEventListener('visibilitychange', on);
    return () => {
      window.removeEventListener('focus', on);
      document.removeEventListener('visibilitychange', on);
    };
  }, []);
  const d = DHIKR.find((x) => x.id === t.id) ?? DHIKR[0];
  const target = targetOf(t, d);
  const count = t.counts[d.id] ?? 0;
  const count1 = () => {
    const r = tap(t);
    saveTasbih(r.state);
    setT(r.state);
    try {
      navigator.vibrate?.(r.done ? [30, 40, 30] : 12);
    } catch {
      /* ignore */
    }
  };

  const ml = water?.totalMl ?? 0;
  const pct = Math.min(1, ml / Math.max(1, goal));
  const left = timer?.endsAt ? timer.endsAt - now : (timer?.pausedRemaining ?? 0);
  const on = !!timer && left > 0 && (timer.endsAt !== null || timer.pausedRemaining !== null);
  const running = on && !!timer?.endsAt;

  return (
    <div className="n-shortcuts">
      <div className="n-short n-short--tasbih" onClick={() => onOpen('tasbih')} role="button" tabIndex={0}>
        <span className="n-short__icon">
          <NIcon name="sparkle" size={18} stroke={2} />
        </span>
        <b className="n-mono">
          {count}
          {target > 0 && <small>/{target}</small>}
        </b>
        <span className="n-short__label">{d.en}</span>
        <button
          className="n-short__act"
          onClick={(e) => {
            e.stopPropagation();
            count1();
          }}
          aria-label={`Count ${d.en}`}
        >
          +1
        </button>
      </div>

      <div className="n-short n-short--water" onClick={() => onOpen('water')} role="button" tabIndex={0}>
        <span className="n-short__icon">
          <NIcon name="drop" size={18} stroke={2} />
        </span>
        <b>
          {(ml / 1000).toFixed(1)}
          <small> L</small>
        </b>
        <span className="n-short__label">{Math.round(pct * 100)}% of {(goal / 1000).toFixed(1)} L</span>
        <span className="n-short__fill" style={{ height: `${pct * 100}%` }} />
        <button
          className="n-short__act"
          onClick={(e) => {
            e.stopPropagation();
            void w.waterAdd(glass);
          }}
          aria-label={`Add ${glass} ml`}
        >
          +{glass}
        </button>
      </div>

      <div className="n-short n-short--timer" onClick={() => onOpen('timer')} role="button" tabIndex={0}>
        <span className="n-short__icon">
          <NIcon name="timer" size={18} stroke={2} />
        </span>
        <b className="n-mono">{on ? formatMs(left) : '25:00'}</b>
        <span className="n-short__label">{on ? timer?.label || 'Timer' : 'Focus timer'}</span>
        <button
          className="n-short__act"
          onClick={(e) => {
            e.stopPropagation();
            if (on && timer) void w.timerAction(running ? 'pause' : 'resume');
            else void w.timerStart(25 * 60_000, 'Focus');
          }}
          aria-label={running ? 'Pause timer' : 'Start timer'}
        >
          <NIcon name={running ? 'pause' : 'play'} size={14} stroke={2.4} />
        </button>
      </div>

      {showOpt && (
        <div className="n-short n-short--opt" onClick={onOptimize} role="button" tabIndex={0}>
          <span className="n-short__icon">
            <NIcon name="flame" size={18} stroke={2} />
          </span>
          <span className="n-short__opttext">
            <b>Optimize iPhone</b>
            <span className="n-short__label">
              {dev?.battery != null
                ? `Battery ${Math.round(dev.battery * 100)}%${dev.free != null ? ` · ${(dev.free / 1e9).toFixed(1)} GB free` : ''}`
                : 'Battery check · clean junk & duplicates'}
            </span>
          </span>
          <NIcon name="chevronRight" size={18} className="n-short__chev" />
        </div>
      )}
    </div>
  );
}
