import { useMemo, useState } from 'react';
import { errorText } from '../../../island/lib/ipc';
import { daysFromToday, parseYmd, shortDate, ymd } from '../../calendar';
import { FLOW, MOODS, PHASE_HINT, PHASE_LABEL, SYMPTOMS, cycleApi, type CycleData, type CycleDay, type CycleSettings, type CycleStatus, type DayLog } from '../../cycle';
import { useNoor } from '../../context';
import { useLoad, useToday } from '../../hooks';
import { NIcon } from '../../icons';
import { Empty, SectionTitle, Sheet, Switch } from '../../ui';

const KIND_LABEL: Record<string, string> = {
  period: 'Period',
  predictedPeriod: 'Expected period',
  fertile: 'Fertile (higher chance)',
  ovulation: 'Ovulation (estimated)',
  lowerChance: 'Lower chance (estimate)',
};

const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

function inWords(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function CycleView() {
  const { flash } = useNoor();
  const today = useToday();
  const { data, reload: reloadData } = useLoad(() => cycleApi.get(), [], ['cycle']);
  const { data: st, reload: reloadStatus } = useLoad(() => cycleApi.status(), [today], ['cycle']);
  const [logDate, setLogDate] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  const save = async (next: CycleData, message?: string) => {
    try {
      await cycleApi.save(next);
      reloadData();
      reloadStatus();
      if (message) flash(message);
    } catch (e) {
      flash(errorText(e));
    }
  };

  if (!data || !st) return null;
  const name = data.settings.name;
  const current = data.periods[data.periods.length - 1];
  const inPeriod = st.phase === 'period' && current && !current.end;

  const startPeriod = (date: string) => save({ ...data, periods: [...data.periods, { start: date, end: null }] }, 'Period start logged');
  const endPeriod = (date: string) => {
    if (!current) return;
    void save({ ...data, periods: data.periods.map((p) => (p === current ? { ...p, end: date < p.start ? p.start : date } : p)) }, 'Period end logged');
  };

  return (
    <>
      <div className="n-cyc__head">
        <div>
          <strong>{name ? `${name}’s cycle` : 'Cycle tracker'}</strong>
          <span>Private — stays on this iPhone</span>
        </div>
        <button className="n-iconbtn" onClick={() => setSettingsOpen(true)} aria-label="Cycle settings">
          <NIcon name="sliders" size={19} />
        </button>
      </div>

      {!st.hasData ? (
        <section className="n-cyc__intro">
          <Empty icon="calendarStar" title="Start tracking">
            Log the first day of the last period. Noor learns the cycle from there — predictions get better with every cycle.
          </Empty>
          <button className="n-btn n-btn--primary" onClick={() => setStartOpen(true)}>
            <NIcon name="plus" size={18} /> Log last period
          </button>
          <button className="n-link" onClick={() => setSettingsOpen(true)}>
            Set name and usual cycle length
          </button>
        </section>
      ) : (
        <>
          <CycleRing st={st} />
          <div className="n-cyc__actions">
            {inPeriod ? (
              <button className="n-btn n-btn--primary" onClick={() => endPeriod(today)}>
                <NIcon name="check" size={18} /> Period ended today
              </button>
            ) : (
              <button className="n-btn n-btn--primary" onClick={() => void startPeriod(today)}>
                <NIcon name="drop" size={18} /> Period started today
              </button>
            )}
            <button className="n-btn n-btn--ghost" onClick={() => setStartOpen(true)}>
              Other date
            </button>
          </div>

          <WeekStrip days={st.days} today={today} onPick={setLogDate} />

          <div className="n-cyc__cards">
            {st.nextStart && (
              <div className="n-cyc__card is-period">
                <span>Next period</span>
                <strong>{shortDate(st.nextStart)}</strong>
                <small>
                  {st.lateDays > 0 ? `${st.lateDays} days late` : inWords(daysFromToday(st.nextStart))}
                  {st.nextWindow && ` · ${shortDate(st.nextWindow[0])} – ${shortDate(st.nextWindow[1])}`}
                </small>
              </div>
            )}
            {st.fertileStart && st.fertileEnd && (
              <div className="n-cyc__card is-fertile">
                <span>Fertile window</span>
                <strong>
                  {shortDate(st.fertileStart).replace(/^\w+, /, '')} – {shortDate(st.fertileEnd).replace(/^\w+, /, '')}
                </strong>
                <small>Ovulation ≈ {st.ovulation ? shortDate(st.ovulation) : '—'}</small>
              </div>
            )}
          </div>

          <div className="n-cyc__safe">
            <div className="n-cyc__safe-head">
              <NIcon name="info" size={16} />
              <strong>Lower-chance days</strong>
            </div>
            {st.calendarFertileDays ? (
              <p>
                By the calendar method, cycle days <b>1–{st.calendarFertileDays[0] - 1}</b> and from day <b>{st.calendarFertileDays[1] + 1}</b> to the next period have a lower chance of pregnancy (shown in
                the calendar). Days {st.calendarFertileDays[0]}–{st.calendarFertileDays[1]} may be fertile.
              </p>
            ) : (
              <p>{st.calendarNote}</p>
            )}
            <small>This is an estimate, not birth control — about 1 in 4 couples relying on calendar methods alone get pregnant within a year. A doctor can advise on reliable options.</small>
          </div>

          {st.insights.length > 0 && (
            <>
              <SectionTitle>Insights</SectionTitle>
              <div className="n-list">
                {st.insights.map((i) => (
                  <div key={i} className="n-row n-row--icon">
                    <span className="n-row__icon">
                      <NIcon name="sparkle" size={15} />
                    </span>
                    <span className="n-row__text">
                      <span className="n-row__detail n-cyc__insight">{i}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionTitle>Calendar</SectionTitle>
          <CycleMonth days={st.days} today={today} onPick={setLogDate} />

          <SectionTitle>Averages</SectionTitle>
          <div className="n-stats">
            <div>
              <strong>{st.avgCycle}</strong>
              <span>Cycle days</span>
            </div>
            <div>
              <strong>{st.avgPeriod}</strong>
              <span>Period days</span>
            </div>
            <div>
              <strong>{st.cyclesLogged}</strong>
              <span>Cycles</span>
            </div>
            <div>
              <strong>{st.shortest && st.longest ? `${st.shortest}–${st.longest}` : '—'}</strong>
              <span>Range</span>
            </div>
          </div>
          {st.history.length > 1 && <HistoryBars history={st.history} />}

          <SectionTitle>Periods</SectionTitle>
          <div className="n-list">
            {[...data.periods].reverse().slice(0, 12).map((p, i, arr) => {
              const prev = arr[i + 1];
              const len = p.end ? Math.round((parseYmd(p.end).getTime() - parseYmd(p.start).getTime()) / 86_400_000) + 1 : null;
              const cyc = prev ? Math.round((parseYmd(p.start).getTime() - parseYmd(prev.start).getTime()) / 86_400_000) : null;
              return (
                <div key={p.start} className="n-row">
                  <span className="n-row__text">
                    <span className="n-row__title">
                      {shortDate(p.start)}
                      {p.end ? ` – ${shortDate(p.end)}` : ' · ongoing'}
                    </span>
                    <span className="n-row__detail">
                      {len ? `${len} days` : 'End not logged'}
                      {cyc ? ` · cycle ${cyc} days` : ''}
                    </span>
                  </span>
                  <button className="n-iconbtn n-iconbtn--faint" aria-label="Delete" onClick={() => void save({ ...data, periods: data.periods.filter((x) => x.start !== p.start) }, 'Period removed')}>
                    <NIcon name="trash" size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="n-hint">Predictions are estimates from the logged history and can be wrong, especially when cycles are irregular. This isn’t medical advice.</p>

      <StartSheet open={startOpen} today={today} onClose={() => setStartOpen(false)} onSave={(start, end) => void save({ ...data, periods: [...data.periods, { start, end }] }, 'Period logged')} />
      <DaySheet date={logDate} data={data} st={st} onClose={() => setLogDate(null)} onSave={save} />
      <SettingsSheet open={settingsOpen} value={data.settings} onClose={() => setSettingsOpen(false)} onSave={(settings) => void save({ ...data, settings }, 'Saved')} />
    </>
  );
}

function CycleRing({ st }: { st: CycleStatus }) {
  const len = Math.max(20, Math.round(st.avgCycle));
  const size = 240;
  const r = 100;
  const c = size / 2;
  const angle = (day: number) => ((day - 1) / len) * 2 * Math.PI - Math.PI / 2;
  const at = (day: number, rr = r): [number, number] => [c + rr * Math.cos(angle(day)), c + rr * Math.sin(angle(day))];
  const arc = (d0: number, d1: number) => {
    const [x0, y0] = at(d0);
    const [x1, y1] = at(d1 + 1);
    const large = (d1 + 1 - d0) / len > 0.5 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  const cd = (iso: string | null) => (iso && st.lastStart ? Math.round((parseYmd(iso).getTime() - parseYmd(st.lastStart).getTime()) / 86_400_000) + 1 : null);
  const fs = cd(st.fertileStart);
  const fe = cd(st.fertileEnd);
  const ov = cd(st.ovulation);
  const day = Math.min(st.cycleDay ?? 1, len);
  const [mx, my] = at(day);
  const plen = Math.max(1, Math.round(st.avgPeriod));

  return (
    <section className={`n-cyc__ring is-${st.phase}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} className="n-cyc__track" />
        <path d={arc(1, plen)} className="n-cyc__seg is-period" />
        {fs && fe && fs > 0 && <path d={arc(fs, Math.min(fe, len))} className="n-cyc__seg is-fertile" />}
        {ov && ov > 0 && ov <= len && <circle cx={at(ov)[0]} cy={at(ov)[1]} r={7} className="n-cyc__ovu" />}
        <circle cx={mx} cy={my} r={12} className="n-cyc__now" />
      </svg>
      <div className="n-cyc__center">
        <span>Day</span>
        <strong>{st.cycleDay ?? '—'}</strong>
        <em>{PHASE_LABEL[st.phase]}</em>
        <small>
          {st.phase === 'late'
            ? `${st.lateDays} day${st.lateDays === 1 ? '' : 's'} late`
            : st.daysUntilNext !== null
              ? st.phase === 'period'
                ? `of ~${Math.round(st.avgPeriod)} period days`
                : `Period ${inWords(st.daysUntilNext)}`
              : ''}
        </small>
      </div>
      <p className="n-cyc__hint">{PHASE_HINT[st.phase]}</p>
    </section>
  );
}

function WeekStrip({ days, today, onPick }: { days: CycleDay[]; today: string; onPick: (d: string) => void }) {
  const i = days.findIndex((d) => d.date === today);
  const week = i >= 0 ? days.slice(Math.max(0, i - 3), i + 4) : [];
  return (
    <div className="n-cyc__week">
      {week.map((d) => (
        <button key={d.date} className={`n-cyc__wd k-${d.kind} ${d.date === today ? 'is-today' : ''}`} onClick={() => onPick(d.date)}>
          <span>{parseYmd(d.date).toLocaleDateString('en-GB', { weekday: 'narrow' })}</span>
          <b>{parseYmd(d.date).getDate()}</b>
          {d.logged && <i />}
        </button>
      ))}
    </div>
  );
}

function CycleMonth({ days, today, onPick }: { days: CycleDay[]; today: string; onPick: (d: string) => void }) {
  const t = parseYmd(today);
  const [ym, setYm] = useState({ y: t.getFullYear(), m: t.getMonth() });
  const map = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const first = new Date(ym.y, ym.m, 1);
  const n = new Date(ym.y, ym.m + 1, 0).getDate();
  const shift = (k: number) => {
    const d = new Date(ym.y, ym.m + k, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };
  return (
    <div className="n-cyc__month">
      <div className="n-cyc__mhead">
        <button className="n-iconbtn" onClick={() => shift(-1)} aria-label="Previous month">
          <NIcon name="chevronLeft" size={18} />
        </button>
        <strong>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</strong>
        <button className="n-iconbtn" onClick={() => shift(1)} aria-label="Next month">
          <NIcon name="chevronRight" size={18} />
        </button>
      </div>
      <div className="n-cyc__grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <span key={i} className="n-cyc__wh">
            {w}
          </span>
        ))}
        {Array.from({ length: first.getDay() }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: n }, (_, i) => {
          const date = ymd(new Date(ym.y, ym.m, i + 1));
          const d = map.get(date);
          return (
            <button key={date} className={`n-cyc__cell k-${d?.kind ?? 'other'} ${date === today ? 'is-today' : ''}`} onClick={() => onPick(date)}>
              {i + 1}
              {d?.logged && <i />}
            </button>
          );
        })}
      </div>
      <div className="n-cyc__legend">
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <span key={k}>
            <i className={`k-${k}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function HistoryBars({ history }: { history: number[] }) {
  const max = Math.max(...history, 35);
  return (
    <div className="n-cyc__bars" aria-label="Recent cycle lengths">
      {history.map((h, i) => (
        <div key={i}>
          <span style={{ height: `${(h / max) * 100}%` }} className={h < 21 || h > 35 ? 'is-out' : ''} />
          <small>{h}</small>
        </div>
      ))}
    </div>
  );
}

function StartSheet({ open, today, onClose, onSave }: { open: boolean; today: string; onClose: () => void; onSave: (start: string, end: string | null) => void }) {
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState('');
  if (!open) return null;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Log a period"
      actions={
        <button
          className="n-link n-link--strong"
          disabled={!start || start > today}
          onClick={() => {
            onSave(start, end && end >= start ? end : null);
            onClose();
          }}
        >
          Save
        </button>
      }
    >
      <div className="n-form">
        <label className="n-field">
          <span>First day</span>
          <input className="n-input" type="date" max={today} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="n-field">
          <span>Last day (optional)</span>
          <input className="n-input" type="date" min={start} max={addDays(start, 14)} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <p className="n-hint n-hint--flush">Add past periods too — with 3 or more, predictions follow the real cycle instead of the default.</p>
      </div>
    </Sheet>
  );
}

function DaySheet({ date, data, st, onClose, onSave }: { date: string | null; data: CycleData; st: CycleStatus; onClose: () => void; onSave: (d: CycleData, msg?: string) => Promise<void> }) {
  const existing = data.logs.find((l) => l.date === date);
  const [draft, setDraft] = useState<DayLog | null>(null);
  if (!date) {
    if (draft) setDraft(null);
    return null;
  }
  const d: DayLog = draft && draft.date === date ? draft : (existing ?? { date, flow: 0, symptoms: [], mood: '', note: '' });
  const set = (patch: Partial<DayLog>) => setDraft({ ...d, ...patch });
  const info = st.days.find((x) => x.date === date);
  const period = data.periods.find((p) => date >= p.start && date <= (p.end ?? p.start));

  const save = async () => {
    const empty = !d.flow && !d.symptoms.length && !d.mood && !d.note.trim();
    const logs = data.logs.filter((l) => l.date !== date);
    let periods = data.periods;
    if (d.flow >= 2 && !period && !data.periods.some((p) => p.start === date)) {
      // A real flow on a day outside any logged period starts a new one.
      periods = [...periods, { start: date, end: null }];
    }
    await onSave({ ...data, periods, logs: empty ? logs : [...logs, d] }, 'Day saved');
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={parseYmd(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}
      actions={
        <button className="n-link n-link--strong" onClick={() => void save()}>
          Save
        </button>
      }
    >
      <div className="n-form">
        {info && info.kind !== 'other' && (
          <div className={`n-cyc__daytag k-${info.kind}`}>
            {KIND_LABEL[info.kind]}
            {info.cycleDay ? ` · cycle day ${info.cycleDay}` : ''}
          </div>
        )}
        <div className="n-field">
          <span>Flow</span>
          <div className="n-choice">
            {FLOW.map((f, i) => (
              <button key={f} className={d.flow === i ? 'is-on' : ''} onClick={() => set({ flow: i })}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="n-field">
          <span>Symptoms</span>
          <div className="n-choice">
            {SYMPTOMS.map((x) => (
              <button key={x} className={d.symptoms.includes(x) ? 'is-on' : ''} onClick={() => set({ symptoms: d.symptoms.includes(x) ? d.symptoms.filter((y) => y !== x) : [...d.symptoms, x] })}>
                {x}
              </button>
            ))}
          </div>
        </div>
        <div className="n-field">
          <span>Mood</span>
          <div className="n-choice">
            {MOODS.map((m) => (
              <button key={m} className={d.mood === m ? 'is-on' : ''} onClick={() => set({ mood: d.mood === m ? '' : m })}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <label className="n-field">
          <span>Note</span>
          <input className="n-input" value={d.note} maxLength={500} placeholder="Anything to remember…" onChange={(e) => set({ note: e.target.value })} />
        </label>
        {period && (
          <button
            className="n-btn n-btn--ghost"
            onClick={() => {
              void onSave({ ...data, periods: data.periods.map((p) => (p === period ? { ...p, end: date } : p)) }, 'Period end set');
              onClose();
            }}
          >
            Make this the last day of the period
          </button>
        )}
      </div>
    </Sheet>
  );
}

function SettingsSheet({ open, value, onClose, onSave }: { open: boolean; value: CycleSettings; onClose: () => void; onSave: (s: CycleSettings) => void }) {
  const [s, setS] = useState(value);
  const [was, setWas] = useState(false);
  if (open && !was) {
    setWas(true);
    setS(value);
  }
  if (!open) {
    if (was) setWas(false);
    return null;
  }
  const set = (patch: Partial<CycleSettings>) => setS((x) => ({ ...x, ...patch }));
  const stepper = (v: number, min: number, max: number, on: (n: number) => void) => (
    <div className="n-stepper">
      <button onClick={() => on(Math.max(min, v - 1))}>−</button>
      <span className="n-stepper__v">{v}</span>
      <button onClick={() => on(Math.min(max, v + 1))}>+</button>
    </div>
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title="Cycle settings"
      actions={
        <button
          className="n-link n-link--strong"
          onClick={() => {
            onSave(s);
            onClose();
          }}
        >
          Save
        </button>
      }
    >
      <div className="n-form">
        <label className="n-field">
          <span>Name (shown only in Noor)</span>
          <input className="n-input" value={s.name} maxLength={40} placeholder="e.g. Ayesha" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="n-pick">
          <div className="n-pick__text">
            <strong>Usual cycle length</strong>
            <small>Used until 3 cycles are logged</small>
          </div>
          {stepper(s.cycleLen, 20, 45, (n) => set({ cycleLen: n }))}
        </div>
        <div className="n-pick">
          <div className="n-pick__text">
            <strong>Usual period length</strong>
            <small>Days of bleeding</small>
          </div>
          {stepper(s.periodLen, 2, 10, (n) => set({ periodLen: n }))}
        </div>
        <div className="n-switchrow">
          <span>
            Period reminder
            <small>{s.remindDaysBefore} day(s) before, and on the expected day</small>
          </span>
          <Switch checked={s.remindPeriod} onChange={(v) => set({ remindPeriod: v })} />
        </div>
        {s.remindPeriod && (
          <div className="n-pick">
            <div className="n-pick__text">
              <strong>Days before</strong>
            </div>
            {stepper(s.remindDaysBefore, 0, 7, (n) => set({ remindDaysBefore: n }))}
          </div>
        )}
        <div className="n-switchrow">
          <span>
            Fertile window reminder
            <small>The day before it starts</small>
          </span>
          <Switch checked={s.remindFertile} onChange={(v) => set({ remindFertile: v })} />
        </div>
        <label className="n-field">
          <span>Reminder time</span>
          <input className="n-input" type="time" value={s.remindTime} onChange={(e) => set({ remindTime: e.target.value })} />
        </label>
        <div className="n-switchrow">
          <span>
            Discreet notifications
            <small>Lock screen shows “Cycle reminder” instead of details</small>
          </span>
          <Switch checked={s.discreet} onChange={(v) => set({ discreet: v })} />
        </div>
      </div>
    </Sheet>
  );
}
