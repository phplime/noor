import { useEffect, useState } from 'react';
import { formatMs, w, type TimerState, type WaterToday } from '../../../island/lib/widgets';
import type { PrayerTab, RoutineTab } from '../../context';
import { NIcon } from '../../icons';
import { DHIKR, loadTasbih, rollDay, saveTasbih, tap, targetOf, type TasbihState } from '../../tasbih';

/** Three one-tap shortcuts at the top of Home: Tasbih, Water, Timer. */
export function ShortcutsCard({
  water,
  goal,
  glass,
  timer,
  now,
  onOpen,
}: {
  water: WaterToday | null;
  goal: number;
  glass: number;
  timer: TimerState | null;
  now: number;
  onOpen: (t: RoutineTab | PrayerTab) => void;
}) {
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
    </div>
  );
}
