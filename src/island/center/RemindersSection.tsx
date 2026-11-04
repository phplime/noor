import { useState } from 'react';
import { api, errorText } from '../lib/ipc';
import { useAutoSave } from '../lib/hooks';
import { describeOffset, formatTime } from '../lib/time';
import {
  PRAYER_NAMES,
  SOUNDS,
  SOUND_LABELS,
  type Prayer,
  type PrayerNotificationConfig,
  type PrayerNotificationSettings,
  type PrayerReminder,
  type PrayerSnapshot,
} from '../lib/types';
import { Card, Notice, NumberInput, Row, SaveStatus, Toggle } from '../components/Field';

const QUICK: { label: string; offset: number }[] = [
  { label: '30 before', offset: -30 },
  { label: '15 before', offset: -15 },
  { label: '10 before', offset: -10 },
  { label: '5 before', offset: -5 },
  { label: 'At time', offset: 0 },
  { label: '5 after', offset: 5 },
];

export function RemindersSection({ snapshot }: { snapshot: PrayerSnapshot }) {
  const { draft, setDraft, status, error } = useAutoSave<PrayerNotificationSettings>(
    snapshot.settings.notifications,
    api.saveNotifications,
  );
  const [testMsg, setTestMsg] = useState<string | null>(null);
  if (!draft) return null;

  const updateConfig = (prayer: Prayer, fn: (c: PrayerNotificationConfig) => PrayerNotificationConfig) =>
    setDraft((d) => ({ ...d, prayers: d.prayers.map((c) => (c.prayer === prayer ? fn(c) : c)) }));

  const test = async () => {
    try {
      await api.testNotification('asr', draft.defaultSound);
      setTestMsg('Test notification sent. If nothing appeared, check the notification permission below.');
    } catch (e) {
      setTestMsg(errorText(e));
    }
  };

  return (
    <div className="section">
      <header className="section__head">
        <h1>
          Notifications <SaveStatus status={status} error={error} />
        </h1>
        <p>Set as many reminders per prayer as you like — before, at, or after the prayer time.</p>
      </header>

      <Card title="General">
        <Row label="Prayer notifications" hint="Master switch for every prayer reminder.">
          <Toggle checked={draft.masterEnabled} onChange={(v) => setDraft((d) => ({ ...d, masterEnabled: v }))} />
        </Row>
        <Row label="Default sound" hint="Used by reminders that don't pick their own sound.">
          <div className="inline">
            <SoundSelect value={draft.defaultSound} onChange={(v) => setDraft((d) => ({ ...d, defaultSound: v }))} />
            <button className="btn" onClick={() => void api.previewSound(draft.defaultSound)}>
              ▶︎
            </button>
          </div>
        </Row>
        <Row label="Test" hint="Sends a sample reminder in 5 seconds — lock your iPhone to hear it.">
          <button className="btn btn--accent" onClick={() => void test()}>
            Send test notification
          </button>
        </Row>
        {testMsg && <Notice>{testMsg}</Notice>}
        <Notice kind="info">
          Noor schedules your reminders with iOS, so they ring even when the app is closed or your iPhone is locked. If
          they don't appear, allow <strong>Noor</strong> in Settings › Notifications (Sounds + Banners on).{' '}
          <button className="link-btn" onClick={() => void api.openSystemSettings('notifications')}>
            Open Noor's settings
          </button>
          <br />
          iOS keeps about a week of reminders queued — open Noor now and then (it refreshes them automatically). Silent
          mode and Focus can mute or hide them.
        </Notice>
      </Card>

      {draft.prayers.map((cfg) => (
        <PrayerCard
          key={cfg.prayer}
          cfg={cfg}
          disabled={!draft.masterEnabled}
          timeLabel={(() => {
            const e = snapshot.today.entries.find((x) => x.prayer === cfg.prayer);
            return e
              ? `Today ${formatTime(e.time, snapshot.activeLocation.timezone, snapshot.settings.display.use24Hour)}`
              : '';
          })()}
          onChange={(fn) => updateConfig(cfg.prayer, fn)}
        />
      ))}
    </div>
  );
}

function PrayerCard({
  cfg,
  disabled,
  timeLabel,
  onChange,
}: {
  cfg: PrayerNotificationConfig;
  disabled: boolean;
  timeLabel: string;
  onChange: (fn: (c: PrayerNotificationConfig) => PrayerNotificationConfig) => void;
}) {
  const [adding, setAdding] = useState(false);
  const name = PRAYER_NAMES[cfg.prayer];
  const offsets = new Set(cfg.reminders.map((r) => r.offsetMinutes));

  const add = async (offset: number) => {
    if (offsets.has(offset)) return;
    setAdding(true);
    try {
      const r = await api.newReminder(cfg.prayer, offset);
      onChange((c) => ({ ...c, enabled: true, reminders: [...c.reminders, r].sort((a, b) => a.offsetMinutes - b.offsetMinutes) }));
    } finally {
      setAdding(false);
    }
  };

  const update = (id: string, patch: Partial<PrayerReminder>) =>
    onChange((c) => ({ ...c, reminders: c.reminders.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const remove = (id: string) => onChange((c) => ({ ...c, reminders: c.reminders.filter((r) => r.id !== id) }));

  const dupes = cfg.reminders.length - offsets.size;

  return (
    <Card
      title={
        <span className={`pcard__title ${disabled ? 'is-dim' : ''}`}>
          {name}
          {cfg.prayer === 'sunrise' && <span className="pcard__tag">informational</span>}
          <span className="pcard__time">{timeLabel}</span>
        </span>
      }
      actions={<Toggle label={`${name} reminders`} checked={cfg.enabled} disabled={disabled} onChange={(v) => onChange((c) => ({ ...c, enabled: v }))} />}
    >
      <div className={`reminders ${!cfg.enabled || disabled ? 'is-dim' : ''}`}>
        {cfg.reminders.length === 0 && <div className="empty">No reminders for {name}.</div>}
        {cfg.reminders.map((r) => (
          <ReminderRow key={r.id} r={r} onUpdate={(p) => update(r.id, p)} onRemove={() => remove(r.id)} />
        ))}
        {dupes > 0 && <Notice kind="warn">Reminders with the same time are combined into one notification.</Notice>}
        <div className="quick">
          <span>Add:</span>
          {QUICK.map((q) => (
            <button key={q.offset} className="chip-btn" disabled={adding || offsets.has(q.offset)} onClick={() => void add(q.offset)}>
              + {q.label}
            </button>
          ))}
          <CustomAdd disabled={adding} onAdd={(o) => void add(o)} taken={offsets} />
        </div>
      </div>
    </Card>
  );
}

function ReminderRow({
  r,
  onUpdate,
  onRemove,
}: {
  r: PrayerReminder;
  onUpdate: (p: Partial<PrayerReminder>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dir = r.offsetMinutes === 0 ? 'at' : r.offsetMinutes < 0 ? 'before' : 'after';
  const minutes = Math.abs(r.offsetMinutes);

  const setDir = (d: string) => {
    if (d === 'at') onUpdate({ offsetMinutes: 0 });
    else onUpdate({ offsetMinutes: (d === 'before' ? -1 : 1) * Math.max(1, minutes || 10) });
  };

  return (
    <div className={`rrow ${r.enabled ? '' : 'is-off'}`}>
      <div className="rrow__main">
        <input type="checkbox" checked={r.enabled} onChange={(e) => onUpdate({ enabled: e.target.checked })} title="Enabled" />
        {dir !== 'at' && (
          <NumberInput
            value={minutes}
            min={1}
            max={180}
            width={60}
            suffix="min"
            onChange={(v) => onUpdate({ offsetMinutes: (dir === 'before' ? -1 : 1) * v })}
          />
        )}
        <select value={dir} onChange={(e) => setDir(e.target.value)}>
          <option value="before">before prayer</option>
          <option value="at">at prayer time</option>
          <option value="after">after prayer</option>
        </select>
        <span className="rrow__desc">{describeOffset(r.offsetMinutes)}</span>
        <SoundSelect value={r.sound ?? ''} allowInherit onChange={(v) => onUpdate({ sound: v || null })} />
        <button className="btn btn--ghost" onClick={() => setOpen(!open)}>
          {open ? 'Hide text' : 'Text…'}
        </button>
        <button className="btn btn--danger" onClick={onRemove} title="Remove reminder">
          Remove
        </button>
      </div>
      {open && (
        <div className="rrow__text">
          <label>
            Title
            <input
              type="text"
              placeholder={r.offsetMinutes === 0 ? 'Prayer Time — {prayer}' : r.offsetMinutes < 0 ? 'Prayer Reminder — {prayer}' : '{prayer} — {minutes} minutes ago'}
              value={r.title ?? ''}
              onChange={(e) => onUpdate({ title: e.target.value || null })}
            />
          </label>
          <label>
            Message
            <input
              type="text"
              placeholder={r.offsetMinutes === 0 ? 'It is time for {prayer} prayer.' : r.offsetMinutes < 0 ? '{prayer} prayer is in {minutes} minutes ({time}).' : '{prayer} began {minutes} minutes ago at {time}.'}
              value={r.message ?? ''}
              onChange={(e) => onUpdate({ message: e.target.value || null })}
            />
          </label>
          <div className="hint">
            Placeholders: <code>{'{prayer}'}</code> <code>{'{minutes}'}</code> <code>{'{time}'}</code>. Leave empty for the default text.
          </div>
        </div>
      )}
    </div>
  );
}

function CustomAdd({ onAdd, disabled, taken }: { onAdd: (o: number) => void; disabled: boolean; taken: Set<number> }) {
  const [minutes, setMinutes] = useState(20);
  const [dir, setDir] = useState<'before' | 'after'>('before');
  const offset = (dir === 'before' ? -1 : 1) * minutes;
  return (
    <span className="custom-add">
      <NumberInput value={minutes} min={1} max={180} width={56} onChange={setMinutes} />
      <select value={dir} onChange={(e) => setDir(e.target.value as 'before' | 'after')}>
        <option value="before">min before</option>
        <option value="after">min after</option>
      </select>
      <button className="chip-btn" disabled={disabled || taken.has(offset)} onClick={() => onAdd(offset)}>
        + Add
      </button>
    </span>
  );
}

function SoundSelect({ value, onChange, allowInherit }: { value: string; onChange: (v: string) => void; allowInherit?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="Sound">
      {allowInherit && <option value="">Default sound</option>}
      {SOUNDS.map((s) => (
        <option key={s} value={s}>
          {SOUND_LABELS[s] ?? s}
        </option>
      ))}
    </select>
  );
}
