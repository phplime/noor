import { useEffect, useState } from 'react';
import { errorText } from '../../../island/lib/ipc';
import { useNow } from '../../../island/lib/hooks';
import { useWidgetData } from '../../../island/lib/widgets';
import { inLabel, noor, nextOccurrence, REPEAT_LABELS, toLocalInput, type Reminder, type ReminderInput, type Repeat, type SoundInfo } from '../../api';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { playSound } from '../../sound';
import { Empty, SectionTitle, Sheet, Switch } from '../../ui';

/** Calm label colours (shown as a thin bar). */
const COLORS = ['#5b8def', '#8b7cf6', '#d9739f', '#d98b4a', '#3fa985', '#4aa5c8', '#b89a4e'];

const QUICK: { title: string; repeat: Repeat; hour: number; minute: number; note?: string }[] = [
  { title: 'Read Quran', repeat: 'daily', hour: 6, minute: 0 },
  { title: 'Morning adhkar', repeat: 'daily', hour: 7, minute: 0 },
  { title: 'Evening adhkar', repeat: 'daily', hour: 17, minute: 30 },
  { title: 'Jumu’ah — Surah Al-Kahf', repeat: 'weekly', hour: 10, minute: 0, note: 'Friday' },
  { title: 'Take vitamins', repeat: 'daily', hour: 9, minute: 0 },
];

function nextFriday(h: number, m: number): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  const add = (5 - d.getDay() + 7) % 7 || (d.getTime() < Date.now() ? 7 : 0);
  d.setDate(d.getDate() + add);
  return d;
}

function whenLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const today = new Date(now);
  const tomorrow = new Date(now + 86400_000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

export function RemindersView() {
  const { flash, permission, askPermission } = useNoor();
  const { data } = useWidgetData('reminders', noor.reminders);
  const now = useNow(30_000);
  const [editing, setEditing] = useState<ReminderInput | null>(null);

  const list = (data ?? []).map((r) => ({ r, next: nextOccurrence(r, now) }));
  const active = list.filter((x) => x.next !== null).sort((a, b) => (a.next ?? 0) - (b.next ?? 0));
  const inactive = list.filter((x) => x.next === null);

  const blank = (): ReminderInput => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(0, 0, 0);
    return { title: '', note: '', at: toLocalInput(d), repeat: 'never', enabled: true, sound: 'noor_chime', color: COLORS[0], before: [], exact: true, alarm: false };
  };

  const toggle = async (r: Reminder, v: boolean) => {
    try {
      await noor.reminderSetEnabled(r.id, v);
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <>
      {permission && permission !== 'granted' && (
        <button className="n-banner n-card n-card--tap" onClick={() => void askPermission()}>
          <NIcon name="bell" size={22} />
          <div>
            <strong>Notifications are off</strong>
            <span>Tap to allow — reminders ring with sound even when Noor is closed.</span>
          </div>
        </button>
      )}

      <button className="n-add" onClick={() => setEditing(blank())}>
        <span className="n-add__plus">
          <NIcon name="plus" size={20} stroke={2.4} />
        </span>
        New reminder
      </button>

      {active.length === 0 && inactive.length === 0 && (
        <>
          <Empty icon="bell" title="No reminders yet">
            Anything you want to remember — once, daily, on weekdays, weekly or monthly. Each one rings with the sound you pick.
          </Empty>
          <SectionTitle>Quick start</SectionTitle>
          <div className="n-quick">
            {QUICK.map((q) => (
              <button
                key={q.title}
                className="n-quick__item"
                onClick={() => {
                  const d = q.note === 'Friday' ? nextFriday(q.hour, q.minute) : new Date();
                  if (q.note !== 'Friday') {
                    d.setHours(q.hour, q.minute, 0, 0);
                    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
                  }
                  setEditing({ title: q.title, note: '', at: toLocalInput(d), repeat: q.repeat, enabled: true, sound: 'noor_chime', color: COLORS[1], before: [], exact: true, alarm: false });
                }}
              >
                <NIcon name="plus" size={14} stroke={2.4} /> {q.title}
              </button>
            ))}
          </div>
        </>
      )}

      {active.length > 0 && <SectionTitle>Upcoming</SectionTitle>}
      {active.length > 0 && (
        <div className="n-list">
          {active.map(({ r, next }) => (
            <div key={r.id} className="n-rem" onClick={() => setEditing({ ...r })} role="button">
              <span className="n-rem__dot" style={{ background: r.color || COLORS[0] }} />
              <div className="n-rem__text">
                <div className="n-rem__title">{r.title}</div>
                <div className="n-rem__when">
                  {whenLabel(next!, now)} · {REPEAT_LABELS[r.repeat]}
                  {alertsLabel(r) && <> · {alertsLabel(r)}</>}
                </div>
                {r.note && <div className="n-rem__note">{r.note}</div>}
              </div>
              <div className="n-rem__side">
                <span className="n-rem__in">{inLabel(next! - now)}</span>
                <Switch checked={r.enabled} onChange={(v) => void toggle(r, v)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {inactive.length > 0 && <SectionTitle>Off &amp; done</SectionTitle>}
      {inactive.length > 0 && (
        <div className="n-list">
          {inactive.map(({ r }) => (
            <div key={r.id} className="n-rem is-off" onClick={() => setEditing({ ...r })} role="button">
              <span className="n-rem__dot" style={{ background: r.color || COLORS[0] }} />
              <div className="n-rem__text">
                <div className="n-rem__title">{r.title}</div>
                <div className="n-rem__when">
                  {r.enabled ? 'Done' : 'Off'} · {REPEAT_LABELS[r.repeat]}
                </div>
              </div>
              <div className="n-rem__side">
                <Switch checked={r.enabled} onChange={(v) => void toggle(r, v)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <ReminderSheet value={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function ReminderSheet({ value, onClose }: { value: ReminderInput | null; onClose: () => void }) {
  const { flash, permission, askPermission } = useNoor();
  const [draft, setDraft] = useState<ReminderInput | null>(value);
  const [sounds, setSounds] = useState<SoundInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    void noor.sounds().then(setSounds).catch(() => undefined);
  }, []);

  if (!draft) return null;
  const set = (patch: Partial<ReminderInput>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const [date, time] = draft.at.split('T');

  const save = async () => {
    setBusy(true);
    try {
      if (permission !== 'granted') await askPermission();
      await noor.reminderSave({ ...draft, enabled: true });
      flash(draft.id ? 'Reminder updated' : 'Reminder added 🔔');
      onClose();
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id) return;
    try {
      await noor.reminderDelete(draft.id);
      flash('Reminder deleted');
      onClose();
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={draft.id ? 'Edit reminder' : 'New reminder'}
      actions={
        <button className="n-link n-link--strong" disabled={busy || !draft.title.trim()} onClick={() => void save()}>
          Save
        </button>
      }
    >
      <div className="n-form">
        <input className="n-input n-input--big" placeholder="What should I remind you?" value={draft.title} autoFocus={!draft.id} onChange={(e) => set({ title: e.target.value })} />
        <textarea className="n-input" placeholder="Note (optional)" rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />

        <div className="n-field">
          <span>Repeat</span>
          <div className="n-choice">
            {(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => (
              <button key={r} className={draft.repeat === r ? 'is-on' : ''} onClick={() => set({ repeat: r, at: `${dateFor(r, date)}T${time}` })}>
                {REPEAT_LABELS[r]}
              </button>
            ))}
          </div>
        </div>

        {draft.repeat === 'weekly' && (
          <div className="n-field">
            <span>On</span>
            <div className="n-choice n-choice--days">
              {WEEK.map(([label, dow]) => (
                <button key={dow} className={weekdayOf(date) === dow ? 'is-on' : ''} onClick={() => set({ at: `${nextWeekday(dow)}T${time}` })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {draft.repeat === 'monthly' && (
          <label className="n-field">
            <span>Day of the month</span>
            <select className="n-input" value={Number(date.slice(8, 10))} onChange={(e) => set({ at: `${nextMonthDay(Number(e.target.value))}T${time}` })}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                  {d > 28 ? ' (or the last day)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className={draft.repeat === 'never' ? 'n-form__grid' : ''}>
          {draft.repeat === 'never' && (
            <label className="n-field">
              <span>Date</span>
              <input className="n-input" type="date" value={date} onChange={(e) => set({ at: `${e.target.value}T${time}` })} />
            </label>
          )}
          <label className="n-field">
            <span>Time</span>
            <input className="n-input" type="time" value={time} onChange={(e) => set({ at: `${date}T${e.target.value}` })} />
          </label>
        </div>

        <AlertsPicker draft={draft} set={set} />

        <div className="n-field">
          <span>Sound</span>
          <div className="n-sounds">
            {[{ id: 'none', label: 'Silent' }, ...sounds].map((s) => (
              <button
                key={s.id}
                className={draft.sound === s.id ? 'is-on' : ''}
                onClick={() => {
                  set({ sound: s.id });
                  void playSound(s.id);
                }}
              >
                <NIcon name={s.id === 'none' ? 'bellOff' : 'sound'} size={15} />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="n-field">
          <span>Colour</span>
          <div className="n-colors">
            {COLORS.map((c) => (
              <button key={c} className={draft.color === c ? 'is-on' : ''} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
            ))}
          </div>
        </div>

        {draft.id && (
          <button className="n-btn n-btn--danger" onClick={() => void remove()}>
            <NIcon name="trash" size={18} /> Delete reminder
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ---------- Several alerts per reminder ----------

const BEFORE_CHOICES = [5, 10, 15, 30, 60, 120, 1440];

export const minLabel = (m: number) =>
  m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;

/** "30 min + 10 min before · alarm" for the list. */
function alertsLabel(r: { before?: number[]; exact?: boolean; alarm?: boolean }): string {
  const parts: string[] = [];
  if (r.before?.length) parts.push(`${r.before.map(minLabel).join(' + ')} before`);
  if (r.alarm) parts.push('⏰ alarm');
  else if (r.exact === false) parts.push('no alert at the time');
  return parts.join(' · ');
}

function AlertsPicker({ draft, set }: { draft: ReminderInput; set: (p: Partial<ReminderInput>) => void }) {
  const [custom, setCustom] = useState('');
  const before = draft.before ?? [];
  const toggle = (m: number) => {
    const next = before.includes(m) ? before.filter((x) => x !== m) : [...before, m];
    set({ before: next.sort((a, b) => b - a).slice(0, 5) });
  };
  const addCustom = () => {
    const m = Math.round(Number(custom));
    if (m >= 1 && m <= 10080 && !before.includes(m)) toggle(m);
    setCustom('');
  };
  const extra = before.filter((m) => !BEFORE_CHOICES.includes(m));
  const exact = draft.exact ?? true;
  const alarm = draft.alarm ?? false;
  const summary = [...before.map((m) => `${minLabel(m)} before`), exact || alarm ? (alarm ? 'alarm at the time' : 'at the time') : null].filter(Boolean);

  return (
    <div className="n-field n-alerts">
      <span>Alerts</span>
      <div className="n-alerts__box">
        <small>Also remind me before</small>
        <div className="n-choice n-choice--wrap">
          {[...BEFORE_CHOICES, ...extra].map((m) => (
            <button key={m} className={before.includes(m) ? 'is-on' : ''} onClick={() => toggle(m)}>
              {minLabel(m)}
            </button>
          ))}
        </div>
        <div className="n-alerts__custom">
          <input className="n-input" type="number" inputMode="numeric" min={1} max={10080} placeholder="Other: minutes" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="n-chip" disabled={!custom} onClick={addCustom}>
            Add
          </button>
        </div>

        <div className="n-switchrow">
          <span>
            At the exact time
            <small>A notification when it's time</small>
          </span>
          <Switch checked={exact || alarm} onChange={(v) => set({ exact: v, alarm: v ? alarm : false })} />
        </div>
        <div className="n-switchrow">
          <span>
            ⏰ Ring like an alarm until I stop it
            <small>iPhone (iOS 26+): full-screen alarm, rings even on Silent. Otherwise it repeats every minute for 5 minutes.</small>
          </span>
          <Switch checked={alarm} onChange={(v) => set({ alarm: v, exact: v ? true : exact })} />
        </div>
        {summary.length > 0 && <p className="n-alerts__sum">You'll be alerted: {summary.join(', ')}.</p>}
        {!summary.length && <p className="n-alerts__sum is-warn">Pick at least one alert.</p>}
      </div>
    </div>
  );
}

// ---------- Dates for repeating reminders (no date picker needed) ----------

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** Saturday first, as calendars in Bangladesh show it. [label, JS weekday] */
const WEEK: [string, number][] = [
  ['Sat', 6],
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
];

const weekdayOf = (date: string) => parseYmd(date).getDay();

/** Today or the next date that falls on `dow`. */
function nextWeekday(dow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
  return ymd(d);
}

/** This month's `day` if it hasn't passed, otherwise next month's (short months use their last day). */
function nextMonthDay(day: number): string {
  const now = new Date();
  for (let k = 0; k < 2; k++) {
    const y = now.getFullYear();
    const m = now.getMonth() + k;
    const last = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(day, last));
    if (k === 1 || d.getDate() >= now.getDate()) return ymd(d);
  }
  return ymd(now);
}

/** Starting date that fits the repeat rule: daily/weekdays start today; weekly/monthly keep the chosen day. */
function dateFor(r: Repeat, current: string): string {
  if (r === 'daily' || r === 'weekdays') return ymd(new Date());
  if (r === 'weekly') return nextWeekday(weekdayOf(current));
  if (r === 'monthly') return nextMonthDay(Number(current.slice(8, 10)) || 1);
  return current;
}
