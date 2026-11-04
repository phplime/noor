import { useState } from 'react';
import { useNow } from '../../../island/lib/hooks';
import { errorText } from '../../../island/lib/ipc';
import { formatMs, useWidgetData, w } from '../../../island/lib/widgets';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { Card, Ring, SectionTitle, Segmented } from '../../ui';

const PRESETS: { min: number; label?: string }[] = [
  { min: 1 },
  { min: 3 },
  { min: 5 },
  { min: 10 },
  { min: 15 },
  { min: 25, label: 'Focus' },
  { min: 30 },
  { min: 45 },
  { min: 60 },
];

export function TimerView() {
  const [tab, setTab] = useState<'timer' | 'stopwatch'>('timer');
  return (
    <>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { id: 'timer', label: 'Timer' },
          { id: 'stopwatch', label: 'Stopwatch' },
        ]}
      />
      {tab === 'timer' ? <Countdown /> : <Stopwatch />}
    </>
  );
}

function Countdown() {
  const { flash, permission, askPermission } = useNoor();
  const { data: t } = useWidgetData('timer', w.timer);
  const now = useNow(250);
  const [min, setMin] = useState(10);
  const [label, setLabel] = useState('');

  const running = !!t?.endsAt;
  const paused = t?.pausedRemaining != null && !running;
  const remaining = running ? Math.max(0, t!.endsAt! - now) : paused ? t!.pausedRemaining! : 0;
  const active = (running && remaining > 0) || paused;
  const done = running && remaining <= 0;
  const frac = t && t.durationMs > 0 ? remaining / t.durationMs : 0;

  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => flash(errorText(e)));
  const start = (minutes: number, lbl = label) =>
    act(async () => {
      if (permission !== 'granted') await askPermission();
      await w.timerStart(minutes * 60_000, lbl.trim() || undefined);
      flash(`Timer set — you'll hear it even if Noor is closed`);
    });

  return (
    <>
      <Card className="n-timer">
        <Ring value={active ? frac : done ? 0 : 1} size={236} stroke={12} color={done ? 'var(--n-danger)' : 'var(--n-accent)'}>
          <div className="n-timer__value">{active ? formatMs(remaining) : done ? 'Done' : `${min}:00`}</div>
          <div className="n-timer__label">{active || done ? t?.label || 'Timer' : 'minutes'}</div>
        </Ring>

        {active ? (
          <div className="n-timer__ctrl">
            <button className="n-round" onClick={() => act(() => w.timerAction('reset'))} aria-label="Cancel">
              <NIcon name="x" size={22} />
            </button>
            <button className="n-round n-round--big" onClick={() => act(() => w.timerAction(running ? 'pause' : 'resume'))}>
              <NIcon name={running ? 'pause' : 'play'} size={28} />
            </button>
            <button className="n-round" onClick={() => act(() => w.timerAction('add', 60_000))}>
              +1
            </button>
          </div>
        ) : (
          <>
            <div className="n-timer__pick">
              <button className="n-round" onClick={() => setMin((m) => Math.max(1, m - 1))}>
                −
              </button>
              <input className="n-input n-timer__label-in" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <button className="n-round" onClick={() => setMin((m) => Math.min(24 * 60, m + 1))}>
                +
              </button>
            </div>
            <button className="n-btn n-btn--primary" onClick={() => start(min)}>
              <NIcon name="play" size={18} /> Start {min} min
            </button>
            {done && (
              <button className="n-link" onClick={() => act(() => w.timerAction('reset'))}>
                Clear
              </button>
            )}
          </>
        )}
      </Card>

      <SectionTitle>Presets</SectionTitle>
      <div className="n-presets">
        {PRESETS.map((p) => (
          <button key={p.min} className="n-preset" onClick={() => start(p.min, p.label ?? label)}>
            <strong>{p.min}</strong>
            <small>{p.label ?? 'min'}</small>
          </button>
        ))}
      </div>
      <p className="n-hint">When the timer ends you get a notification with the Timer sound — even if Noor is closed or your iPhone is locked.</p>
    </>
  );
}

function Stopwatch() {
  const { flash } = useNoor();
  const { data: s } = useWidgetData('stopwatch', w.stopwatch);
  const now = useNow(50);
  const running = !!s?.startedAt;
  const elapsed = s ? s.accumulatedMs + (s.startedAt ? now - s.startedAt : 0) : 0;
  const act = (a: 'start' | 'stop' | 'lap' | 'reset') => void w.stopwatchAction(a).catch((e) => flash(errorText(e)));
  const cs = Math.floor((elapsed % 1000) / 10)
    .toString()
    .padStart(2, '0');
  const laps = s?.laps ?? [];

  return (
    <>
      <Card className="n-timer">
        <div className="n-stopwatch">
          {formatMs(elapsed, elapsed >= 3600_000)}
          <small>.{cs}</small>
        </div>
        <div className="n-timer__ctrl">
          <button className="n-round" onClick={() => act(running ? 'lap' : 'reset')} disabled={!running && elapsed === 0}>
            {running ? 'Lap' : 'Reset'}
          </button>
          <button className={`n-round n-round--big ${running ? 'is-stop' : ''}`} onClick={() => act(running ? 'stop' : 'start')}>
            <NIcon name={running ? 'pause' : 'play'} size={28} />
          </button>
          <span className="n-round n-round--ghost" />
        </div>
      </Card>
      {laps.length > 0 && (
        <div className="n-list">
          {[...laps].reverse().map((lap, i) => {
            const idx = laps.length - i;
            const prev = idx > 1 ? laps[idx - 2] : 0;
            return (
              <div className="n-row" key={idx}>
                <span className="n-row__text">
                  <span className="n-row__title">Lap {idx}</span>
                </span>
                <span className="n-row__right n-mono">+{formatMs(lap - prev)}</span>
                <span className="n-row__right n-mono">{formatMs(lap)}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
