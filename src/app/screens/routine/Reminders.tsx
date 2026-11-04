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
    return { title: '', note: '', at: toLocalInput(d), repeat: 'never', enabled: true, sound: 'noor_chime', color: COLORS[0] };
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
                  setEditing({ title: q.title, note: '', at: toLocalInput(d), repeat: q.repeat, enabled: true, sound: 'noor_chime', color: COLORS[1] });
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

        <div className="n-form__grid">
          <label className="n-field">
            <span>Date</span>
            <input className="n-input" type="date" value={date} onChange={(e) => set({ at: `${e.target.value}T${time}` })} />
          </label>
          <label className="n-field">
            <span>Time</span>
            <input className="n-input" type="time" value={time} onChange={(e) => set({ at: `${date}T${e.target.value}` })} />
          </label>
        </div>

        <div className="n-field">
          <span>Repeat</span>
          <div className="n-choice">
            {(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => (
              <button key={r} className={draft.repeat === r ? 'is-on' : ''} onClick={() => set({ repeat: r })}>
                {REPEAT_LABELS[r]}
              </button>
            ))}
          </div>
        </div>

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
