import { invoke } from '@tauri-apps/api/core';

/** Commands added by Noor (reminders + notifications). Prayer and widget commands live in src/island/lib. */

export type Repeat = 'never' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface Reminder {
  id: string;
  title: string;
  note: string;
  /** Local "YYYY-MM-DDTHH:MM". */
  at: string;
  repeat: Repeat;
  enabled: boolean;
  sound: string;
  color: string;
  createdAt: number;
}

export type ReminderInput = Omit<Reminder, 'id' | 'createdAt'> & { id?: string };

export interface PlannedNotification {
  kind: 'prayer' | 'ramadan' | 'special' | 'water' | 'timer' | 'reminder' | 'refresh' | 'test';
  route: string;
  fireAt: string;
  title: string;
  body: string;
  sound: string;
}

export interface SoundInfo {
  id: string;
  label: string;
}

export type Permission = 'granted' | 'denied' | 'prompt';

export const noor = {
  reminders: () => invoke<Reminder[]>('reminder_list'),
  reminderSave: (reminder: ReminderInput) => invoke<Reminder>('reminder_save', { reminder }),
  reminderSetEnabled: (id: string, enabled: boolean) => invoke<void>('reminder_set_enabled', { id, enabled }),
  reminderDelete: (id: string) => invoke<void>('reminder_delete', { id }),

  sounds: () => invoke<SoundInfo[]>('notify_sounds'),
  upcoming: (limit = 60) => invoke<PlannedNotification[]>('notify_upcoming', { limit }),
  refresh: () => invoke<void>('notify_refresh'),
  permission: (request = false) => invoke<Permission>('notify_permission', { request }),
  test: (opts: { title?: string; body?: string; sound?: string; delaySecs?: number } = {}) =>
    invoke<void>('notify_test', { title: opts.title, body: opts.body, sound: opts.sound, delaySecs: opts.delaySecs }),
};

export const REPEAT_LABELS: Record<Repeat, string> = {
  never: 'Once',
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Every week',
  monthly: 'Every month',
};

/** Next occurrence (ms) of a reminder from `now`, mirroring crates/nexa-widgets/src/reminders.rs. */
export function nextOccurrence(r: Reminder, now = Date.now()): number | null {
  if (!r.enabled) return null;
  const [d, t] = r.at.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  let cur = new Date(y, m - 1, day, hh, mm);
  if (r.repeat === 'never') return cur.getTime() > now ? cur.getTime() : null;
  for (let i = 0; i < 4000; i++) {
    const wd = cur.getDay();
    const okDay = r.repeat !== 'weekdays' || (wd !== 0 && wd !== 6);
    if (okDay && cur.getTime() > now) return cur.getTime();
    if (r.repeat === 'monthly') {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, hh, mm);
      const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, last));
      cur = next;
    } else {
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + (r.repeat === 'weekly' ? 7 : 1), hh, mm);
    }
  }
  return null;
}

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** Local "YYYY-MM-DDTHH:MM" for a Date. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "in 12m", "in 3h 05m", "in 4 days". */
export function inLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `in ${Math.round(h / 24)} days`;
}
