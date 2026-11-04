import { useEffect, useState } from 'react';
import { errorText } from '../../island/lib/ipc';
import { HIJRI_MONTHS_EN, MONTHS_EN, cal, type DateKind, type SpecialInput } from '../calendar';
import { noor, type SoundInfo } from '../api';
import { useNoor } from '../context';
import { NIcon } from '../icons';
import { playSound } from '../sound';
import { Segmented, Sheet, Switch } from '../ui';

const COLORS = ['#d9739f', '#8b7cf6', '#5b8def', '#3fa985', '#d98b4a', '#b89a4e', '#4aa5c8'];
const BEFORE = [
  { v: 0, l: 'On the day' },
  { v: 1, l: '1 day before' },
  { v: 2, l: '2 days before' },
  { v: 3, l: '3 days before' },
  { v: 7, l: '1 week before' },
];

export function blankSpecial(month: number, day: number): SpecialInput {
  return { title: '', note: '', calendar: 'gregorian', month, day, year: null, alert: true, alertTime: '09:00', daysBefore: 1, sound: 'noor_chime', color: COLORS[0] };
}

/** Add or edit a special day (birthday, anniversary, a Hijri date …) with an optional alert. */
export function SpecialSheet({ value, hijri, onClose }: { value: SpecialInput | null; hijri?: { month: number; day: number }; onClose: () => void }) {
  const { flash, permission, askPermission } = useNoor();
  const [draft, setDraft] = useState<SpecialInput | null>(value);
  const [sounds, setSounds] = useState<SoundInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    void noor.sounds().then(setSounds).catch(() => undefined);
  }, []);

  if (!draft) return null;
  const set = (patch: Partial<SpecialInput>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const monthNames = draft.calendar === 'hijri' ? HIJRI_MONTHS_EN : MONTHS_EN;
  const maxDay = draft.calendar === 'hijri' ? 30 : new Date(2000, draft.month, 0).getDate();

  const switchCalendar = (c: DateKind) => {
    if (c === draft.calendar) return;
    if (c === 'hijri' && hijri) set({ calendar: c, month: hijri.month, day: hijri.day, year: null });
    else set({ calendar: c, month: 1, day: 1, year: null });
  };

  const save = async () => {
    setBusy(true);
    try {
      if (draft.alert && permission !== 'granted') await askPermission();
      await cal.specialSave({ ...draft, day: Math.min(draft.day, maxDay) });
      flash(draft.id ? 'Special day updated' : 'Special day added 🎉');
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
      await cal.specialDelete(draft.id);
      flash('Special day deleted');
      onClose();
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={draft.id ? 'Edit special day' : 'New special day'}
      actions={
        <button className="n-link n-link--strong" disabled={busy || !draft.title.trim()} onClick={() => void save()}>
          Save
        </button>
      }
    >
      <div className="n-form">
        <label className="n-field">
          <span>Name</span>
          <input className="n-input n-input--big" value={draft.title} maxLength={80} placeholder="Birthday, anniversary, Ashura fast…" onChange={(e) => set({ title: e.target.value })} />
        </label>

        <div className="n-field">
          <span>Date type</span>
          <Segmented<DateKind>
            value={draft.calendar}
            options={[
              { id: 'gregorian', label: 'Calendar date' },
              { id: 'hijri', label: 'Hijri date' },
            ]}
            onChange={switchCalendar}
          />
        </div>

        <div className="n-form__grid">
          <label className="n-field">
            <span>Month</span>
            <select className="n-input" value={draft.month} onChange={(e) => set({ month: +e.target.value })}>
              {monthNames.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="n-field">
            <span>Day</span>
            <select className="n-input" value={Math.min(draft.day, maxDay)} onChange={(e) => set({ day: +e.target.value })}>
              {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="n-switchrow">
          <span>
            Repeat every year
            <small>{draft.calendar === 'hijri' ? 'Follows the Hijri calendar, so it moves about 11 days earlier each year.' : 'Birthdays, anniversaries …'}</small>
          </span>
          <Switch checked={draft.year === null} onChange={(v) => set({ year: v ? null : draft.year ?? new Date().getFullYear() })} />
        </div>
        {draft.year !== null && (
          <label className="n-field">
            <span>{draft.calendar === 'hijri' ? 'Hijri year' : 'Year'}</span>
            <input className="n-input" type="number" value={draft.year} onChange={(e) => set({ year: +e.target.value || null })} />
          </label>
        )}

        <div className="n-switchrow">
          <span>
            Alert me
            <small>A notification with sound</small>
          </span>
          <Switch checked={draft.alert} onChange={(v) => set({ alert: v })} />
        </div>

        {draft.alert && (
          <>
            <div className="n-form__grid">
              <label className="n-field">
                <span>When</span>
                <select className="n-input" value={draft.daysBefore} onChange={(e) => set({ daysBefore: +e.target.value })}>
                  {BEFORE.map((b) => (
                    <option key={b.v} value={b.v}>
                      {b.l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="n-field">
                <span>At</span>
                <input className="n-input" type="time" value={draft.alertTime} onChange={(e) => set({ alertTime: e.target.value })} />
              </label>
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
          </>
        )}

        <label className="n-field">
          <span>Note (optional)</span>
          <input className="n-input" value={draft.note} maxLength={500} placeholder="Gift idea, who to call…" onChange={(e) => set({ note: e.target.value })} />
        </label>

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
            <NIcon name="trash" size={18} /> Delete special day
          </button>
        )}
      </div>
    </Sheet>
  );
}
