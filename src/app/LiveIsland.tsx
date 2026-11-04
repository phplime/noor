import { useNow } from '../island/lib/hooks';
import { formatMs, useWidgetData, w } from '../island/lib/widgets';
import { useNoor } from './context';
import { NIcon } from './icons';

/**
 * Nexa Island's "live activity" on the iPhone: a slim mini-bar docked above the tab bar
 * while a timer is running (like a mini player). Hidden on screens that already show the timer.
 */
export function LiveIsland() {
  const { tab, routineTab, go } = useNoor();
  const { data: timer } = useWidgetData('timer', w.timer);
  const now = useNow(timer?.endsAt ? 1000 : 60_000);

  const left = timer?.endsAt ? timer.endsAt - now : (timer?.pausedRemaining ?? 0);
  const on = !!timer && (timer.endsAt !== null || timer.pausedRemaining !== null) && left > 0;
  if (!on || !timer) return null;
  if (tab === 'today' || (tab === 'routine' && routineTab === 'timer')) return null;

  const running = timer.endsAt !== null;
  return (
    <div className="n-mini" onClick={() => go('routine', 'timer')} role="button">
      <span className="n-mini__icon">
        <NIcon name="timer" size={18} stroke={2} />
      </span>
      <span className="n-mini__text">
        <strong>{timer.label || 'Timer'}</strong>
        <span className="n-mono">{formatMs(left)} left</span>
      </span>
      <button
        className="n-mini__btn"
        aria-label={running ? 'Pause' : 'Resume'}
        onClick={(e) => {
          e.stopPropagation();
          void w.timerAction(running ? 'pause' : 'resume');
        }}
      >
        <NIcon name={running ? 'pause' : 'play'} size={18} />
      </button>
      <button
        className="n-mini__btn n-mini__btn--text"
        onClick={(e) => {
          e.stopPropagation();
          void w.timerAction('add', 60_000);
        }}
      >
        +1
      </button>
    </div>
  );
}
