import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/ipc';
import { addDays, formatDateLabel, formatTime, localDate } from '../lib/time';
import { ALL_PRAYERS, PRAYER_NAMES, type DailyPrayerSchedule, type PrayerSnapshot } from '../lib/types';
import { Card } from '../components/Field';
import { SourceBadge } from '../components/SourceBadge';

export function TimetableSection({ snapshot }: { snapshot: PrayerSnapshot }) {
  const { display, calculation } = snapshot.settings;
  const tz = snapshot.activeLocation.timezone;
  const today = snapshot.today.date;
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<DailyPrayerSchedule[]>([]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [monthRows, setMonthRows] = useState<DailyPrayerSchedule[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Selected day + the following day.
  useEffect(() => {
    let alive = true;
    Promise.all([api.schedule(date), api.schedule(addDays(date, 1))])
      .then((r) => alive && (setDay(r), setErr(null)))
      .catch((e) => alive && setErr(errorText(e)));
    return () => {
      alive = false;
    };
  }, [date, snapshot]);

  useEffect(() => {
    let alive = true;
    const [y, m] = month.split('-').map(Number);
    api
      .month(y, m)
      .then((r) => alive && setMonthRows(r))
      .catch((e) => alive && setErr(errorText(e)));
    return () => {
      alive = false;
    };
  }, [month, snapshot]);

  const method = snapshot.methods.find((m) => m.id === calculation.method);
  const offsets = ALL_PRAYERS.filter((p) => calculation.offsets[p] !== 0)
    .map((p) => `${PRAYER_NAMES[p]} ${calculation.offsets[p] > 0 ? '+' : ''}${calculation.offsets[p]}m`)
    .join(', ');
  const cols = ALL_PRAYERS.filter((p) => display.showSunrise || p !== 'sunrise');
  const fmt = (iso: string) => formatTime(iso, tz, display.use24Hour);
  const nowDate = localDate(Date.now(), tz);

  return (
    <div className="section">
      <header className="section__head">
        <h1>Prayer timetable</h1>
        <p>
          {snapshot.activeLocation.name}
          {snapshot.activeLocation.country ? `, ${snapshot.activeLocation.country}` : ''} · {tz} ·{' '}
          {calculation.mode === 'manual' ? 'Manual timetable' : method?.name} · Asr{' '}
          {calculation.asr === 'hanafi' ? 'Hanafi' : 'Standard'}
          {offsets && calculation.mode !== 'manual' ? ` · Adjustments: ${offsets}` : ''}
        </p>
      </header>
      {err && <div className="notice notice--error">{err}</div>}

      <Card
        title="Daily schedule"
        actions={
          <div className="inline">
            <button className="btn" onClick={() => setDate(addDays(date, -1))}>
              ‹
            </button>
            <input type="date" className="date-input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className="btn" onClick={() => setDate(addDays(date, 1))}>
              ›
            </button>
            <button className="btn" disabled={date === today} onClick={() => setDate(today)}>
              Today
            </button>
          </div>
        }
      >
        <div className="days">
          {day.map((s) => (
            <div key={s.date} className="day">
              <div className="day__title">
                {s.date === nowDate ? 'Today' : s.date === addDays(nowDate, 1) ? 'Tomorrow' : ''}{' '}
                <span>{formatDateLabel(s.date, true)}</span>
              </div>
              {s.entries
                .filter((e) => display.showSunrise || e.prayer !== 'sunrise')
                .map((e) => (
                  <div key={e.prayer} className="day__row">
                    <span>
                      {PRAYER_NAMES[e.prayer]} <SourceBadge entry={e} />
                    </span>
                    <strong>{fmt(e.time)}</strong>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Monthly timetable"
        actions={<input type="month" className="date-input" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
      >
        <div className="table-wrap">
          <table className="ttable">
            <thead>
              <tr>
                <th>Date</th>
                {cols.map((p) => (
                  <th key={p}>{PRAYER_NAMES[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthRows.map((s) => (
                <tr key={s.date} className={s.date === nowDate ? 'is-today' : ''}>
                  <td>{formatDateLabel(s.date)}</td>
                  {cols.map((p) => {
                    const e = s.entries.find((x) => x.prayer === p);
                    return (
                      <td key={p} className={e?.source === 'manual' ? 'is-manual' : e?.highLatitudeAdjusted ? 'is-est' : ''}>
                        {e ? fmt(e.time) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="legend__manual">Manual</span> entered by you ·{' '}
          <span className="legend__est">Est.</span> high-latitude estimate · all other times are calculated locally
        </div>
      </Card>
    </div>
  );
}
