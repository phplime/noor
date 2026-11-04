import { useEffect, useState } from 'react';
import { api, errorText } from '../../island/lib/ipc';
import { formatTime } from '../../island/lib/time';
import { PRAYER_NAMES, type PrayerTimeEntry } from '../../island/lib/types';
import { useNoor } from '../context';
import { NIcon } from '../icons';
import { Sheet } from '../ui';

/** "HH:MM" (24h) of an ISO instant in a time zone, for the time input. */
function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
}

const mins = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * iOS time pickers start on AM, so "1:15" for Dhuhr easily lands on 01:15.
 * If the time is far from the calculated one but the 12-hour twin is close, use the twin.
 */
export function fixAmPm(time: string, calculated: string): { time: string; flipped: boolean; far: boolean } {
  const diff = (a: number, b: number) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));
  const t = mins(time);
  const c = mins(calculated);
  if (diff(t, c) <= 180) return { time, flipped: false, far: false };
  const twin = (t + 720) % 1440;
  if (diff(twin, c) <= 180) {
    const hh = String(Math.floor(twin / 60)).padStart(2, '0');
    return { time: `${hh}:${String(twin % 60).padStart(2, '0')}`, flipped: true, far: false };
  }
  return { time, flipped: false, far: true };
}

/** Whether a prayer time was changed by hand (fixed time or minute offset). */
export const isCustom = (e: PrayerTimeEntry) => e.source === 'manual' || e.offsetMinutes !== 0 || !!e.jamaat;

/**
 * Set the mosque's jamaat time for a prayer (or remove it). The prayer still starts at
 * its calculated time; Noor alerts at the start, N minutes before jamaat, and at jamaat.
 */
export function PrayerTimeSheet({ entry, tz, use24, onClose }: { entry: PrayerTimeEntry | null; tz: string; use24: boolean; onClose: () => void }) {
  const { reloadPrayer, flash, snapshot } = useNoor();
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entry) setTime(hhmm(entry.jamaat ?? entry.time, tz));
  }, [entry, tz]);

  if (!entry) return null;
  const name = PRAYER_NAMES[entry.prayer];
  const custom = isCustom(entry);
  const calc = hhmm(entry.calculatedTime ?? entry.time, tz);
  const check = time ? fixAmPm(time, calc) : null;
  const start = hhmm(entry.time, tz);
  const beforeStart = !!check && check.time < start && !(entry.prayer === 'isha' && check.time < '04:00');
  const notif = snapshot?.settings.notifications;
  const before = notif?.jamaatBeforeMinutes ?? 10;
  const setBefore = async (m: number) => {
    if (!notif) return;
    try {
      await api.saveNotifications({ ...notif, jamaatAlerts: true, jamaatBeforeMinutes: m });
      await reloadPrayer();
    } catch (e) {
      flash(errorText(e));
    }
  };
  const shown = (hm: string) => formatTime(new Date(`2000-01-01T${hm}:00`).toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone, use24);

  const run = async (change: Parameters<typeof api.adjustPrayer>[1], message: string) => {
    setBusy(true);
    try {
      await api.adjustPrayer(entry.prayer, change);
      await reloadPrayer();
      flash(message);
      onClose();
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${name} jamaat`}
      actions={
        <button className="n-link n-link--strong" disabled={busy || !time} onClick={() => check && void run({ kind: 'fixed', time: check.time }, `${name} jamaat set to ${shown(check.time)} 🕌`)}>
          Save
        </button>
      }
    >
      <div className="n-form">
        <label className="n-field">
          <span>Jamaat time in your mosque · জামাতের সময়</span>
          <input className="n-input n-input--big n-input--time" type="time" value={time} onChange={(e) => setTime(e.target.value)} autoFocus />
        </label>
        {check?.flipped && (
          <p className="n-hint n-hint--warn">
            {shown(time)} looks like a mistake for {name}, so it will be saved as <b>{shown(check.time)}</b>.
          </p>
        )}
        {check?.far && (
          <p className="n-hint n-hint--warn">This is more than 3 hours from the calculated time. Check AM/PM before saving.</p>
        )}
        {beforeStart && !check?.far && (
          <p className="n-hint n-hint--warn">This is before {name} starts ({shown(start)}). Check the time.</p>
        )}
        <div className="n-jflow">
          <span>
            <b>{shown(start)}</b>
            <small>{name} starts</small>
          </span>
          <i />
          <span>
            <b>{before ? `−${before} min` : '—'}</b>
            <small>reminder</small>
          </span>
          <i />
          <span className="is-j">
            <b>{time ? shown(check?.time ?? time) : '—'}</b>
            <small>jamaat</small>
          </span>
        </div>
        <div className="n-field">
          <span>Remind me before jamaat</span>
          <div className="n-jbefore">
            {[0, 5, 10, 15, 20, 30].map((m) => (
              <button key={m} className={`n-chip ${before === m ? 'is-on' : ''}`} onClick={() => void setBefore(m)}>
                {m === 0 ? 'Off' : `${m} min`}
              </button>
            ))}
          </div>
        </div>
        <p className="n-hint n-hint--flush">
          You’ll get an alert when {name} starts, {before ? `${before} minutes before jamaat, ` : ''}and when jamaat begins. The “before the start” reminder is skipped for this prayer so you don’t get too many.
        </p>
        {custom && (
          <button className="n-btn n-btn--ghost" disabled={busy} onClick={() => void run({ kind: 'reset' }, `${name} jamaat time removed`)}>
            <NIcon name="reset" size={18} /> Remove jamaat time
          </button>
        )}
      </div>
    </Sheet>
  );
}
