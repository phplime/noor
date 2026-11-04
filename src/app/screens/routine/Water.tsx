import { useState } from 'react';
import { errorText } from '../../../island/lib/ipc';
import { useWidgetData, w, type IslandSettings, type WaterReminderMode, type WaterSettings } from '../../../island/lib/widgets';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { Card, List, ListRow, SectionTitle, Segmented, Switch } from '../../ui';

const MODE_HINT: Record<WaterReminderMode, string> = {
  smart: 'Only when you fall behind the pace to reach your goal by the end of the day.',
  interval: 'Every few minutes after your last glass (or the last reminder).',
  times: 'At fixed times every day.',
};

export function WaterView() {
  const { flash } = useNoor();
  const { data: today } = useWidgetData('water', w.water);
  const { data: settings, setData } = useWidgetData('settings', w.settings);
  const [newTime, setNewTime] = useState('15:00');

  const goal = today?.goalMl ?? settings?.water.goalMl ?? 2000;
  const total = today?.totalMl ?? 0;
  const pct = Math.min(1, total / Math.max(1, goal));
  const glass = settings?.water.glassMl ?? 250;

  const saveWater = async (patch: Partial<WaterSettings>) => {
    if (!settings) return;
    const next: IslandSettings = { ...settings, water: { ...settings.water, ...patch } };
    setData(next);
    try {
      setData(await w.saveSettings(next));
    } catch (e) {
      flash(errorText(e));
    }
  };

  const add = async (ml: number) => {
    try {
      await w.waterAdd(ml);
      if (total < goal && total + ml >= goal) flash('Goal reached — well done! 💧');
    } catch (e) {
      flash(errorText(e));
    }
  };

  const maxDay = Math.max(goal, ...(today?.week ?? []).map(([, ml]) => ml));
  const ws = settings?.water;

  return (
    <>
      <Card className="n-water">
        <div className="n-water__glass">
          <div className="n-water__fill" style={{ height: `${pct * 100}%` }}>
            <svg className="n-water__wave" viewBox="0 0 120 12" preserveAspectRatio="none">
              <path d="M0 6 Q 15 0 30 6 T 60 6 T 90 6 T 120 6 V12 H0 Z" />
            </svg>
          </div>
          <div className="n-water__label">
            <strong>{Math.round(pct * 100)}%</strong>
            <span>
              {total} / {goal} ml
            </span>
          </div>
        </div>
        <div className="n-water__actions">
          <button className="n-btn n-btn--water" onClick={() => void add(glass)}>
            <NIcon name="drop" size={18} /> +{glass} ml
          </button>
          <div className="n-water__row">
            {[150, 330, 500].map((ml) => (
              <button key={ml} className="n-chip" onClick={() => void add(ml)}>
                +{ml}
              </button>
            ))}
            <button className="n-chip" onClick={() => void w.waterUndo().catch((e) => flash(errorText(e)))} aria-label="Undo last">
              <NIcon name="undo" size={15} />
            </button>
          </div>
        </div>
      </Card>

      {today && (
        <Card className="n-week">
          <div className="n-week__bars">
            {today.week.map(([date, ml]) => {
              const d = new Date(`${date}T12:00:00`);
              return (
                <div key={date} className={`n-week__col ${ml >= goal ? 'is-met' : ''}`}>
                  <div className="n-week__bar">
                    <span style={{ height: `${Math.max(4, (ml / maxDay) * 100)}%` }} />
                  </div>
                  <small>{d.toLocaleDateString([], { weekday: 'narrow' })}</small>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {ws && (
        <>
          <SectionTitle>Goal</SectionTitle>
          <List>
            <ListRow
              title="Daily goal"
              right={
                <Stepper value={ws.goalMl} step={250} min={500} max={6000} suffix="ml" onChange={(v) => void saveWater({ goalMl: v })} />
              }
            />
            <ListRow title="Glass size" right={<Stepper value={ws.glassMl} step={50} min={50} max={1000} suffix="ml" onChange={(v) => void saveWater({ glassMl: v })} />} />
          </List>

          <SectionTitle>Reminders</SectionTitle>
          <List>
            <ListRow icon="bell" title="Remind me to drink" detail="Rings with the Pop sound" right={<Switch checked={ws.reminders} onChange={(v) => void saveWater({ reminders: v })} />} />
          </List>
          {ws.reminders && (
            <Card className="n-stack">
              <Segmented
                value={ws.mode}
                onChange={(m) => void saveWater({ mode: m })}
                options={[
                  { id: 'smart', label: 'Smart' },
                  { id: 'interval', label: 'Every…' },
                  { id: 'times', label: 'Set times' },
                ]}
              />
              <p className="n-hint">{MODE_HINT[ws.mode]}</p>
              {ws.mode === 'interval' && (
                <div className="n-line">
                  <span>Every</span>
                  <Stepper value={ws.remindEveryMin} step={15} min={15} max={360} suffix="min" onChange={(v) => void saveWater({ remindEveryMin: v })} />
                </div>
              )}
              {ws.mode === 'smart' && (
                <div className="n-line">
                  <span>At most every</span>
                  <Stepper value={ws.minGapMin} step={15} min={15} max={240} suffix="min" onChange={(v) => void saveWater({ minGapMin: v })} />
                </div>
              )}
              {ws.mode === 'times' && (
                <div className="n-times">
                  {ws.times.map((t) => (
                    <span key={t} className="n-time-chip">
                      {t}
                      <button onClick={() => void saveWater({ times: ws.times.filter((x) => x !== t) })} aria-label={`Remove ${t}`}>
                        <NIcon name="x" size={12} stroke={2.4} />
                      </button>
                    </span>
                  ))}
                  <span className="n-time-add">
                    <input type="time" className="n-input" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                    <button
                      className="n-chip"
                      onClick={() => void saveWater({ times: Array.from(new Set([...ws.times, newTime])).sort() })}
                    >
                      Add
                    </button>
                  </span>
                </div>
              )}
              {ws.mode !== 'times' && (
                <div className="n-form__grid">
                  <label className="n-field">
                    <span>From</span>
                    <input className="n-input" type="time" value={ws.start} onChange={(e) => void saveWater({ start: e.target.value })} />
                  </label>
                  <label className="n-field">
                    <span>Until</span>
                    <input className="n-input" type="time" value={ws.end} onChange={(e) => void saveWater({ end: e.target.value })} />
                  </label>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}

export function Stepper({ value, step, min, max, suffix, onChange }: { value: number; step: number; min: number; max: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <span className="n-stepper">
      <button onClick={() => onChange(Math.max(min, value - step))} aria-label="Less">
        −
      </button>
      <span className="n-stepper__v">
        {value}
        {suffix && <small> {suffix}</small>}
      </span>
      <button onClick={() => onChange(Math.min(max, value + step))} aria-label="More">
        +
      </button>
    </span>
  );
}
