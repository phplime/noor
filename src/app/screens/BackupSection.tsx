import { useRef, useState } from 'react';
import { backupNow, lastBackup, peek, restore } from '../backup';
import { useNoor } from '../context';
import { NIcon } from '../icons';
import { List, ListRow, SectionTitle, Sheet } from '../ui';
import { errorText } from '../../island/lib/ipc';

function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** Settings › Backup: save everything to a file, or restore from one. */
export function BackupSection() {
  const { flash } = useNoor();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(lastBackup);
  const [pending, setPending] = useState<{ text: string; createdAt: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const doBackup = async () => {
    setBusy(true);
    try {
      const { info, shared } = await backupNow();
      setLast(Date.now());
      const kb = Math.max(1, Math.round(info.bytes / 1024));
      flash(shared ? `Backup ready (${kb} KB) — choose “Save to Files”` : `Backup saved to Downloads: ${info.fileName}`);
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    const p = peek(text);
    if (!p) {
      flash('That file is not a Noor backup');
      return;
    }
    setPending({ text, createdAt: p.createdAt });
  };

  const doRestore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await restore(pending.text);
    } catch (e) {
      flash(errorText(e));
      setBusy(false);
    }
  };

  const when = pending?.createdAt ? new Date(pending.createdAt) : null;

  return (
    <>
      <SectionTitle>Backup</SectionTitle>
      <List>
        <ListRow
          icon="backup"
          title={busy && !pending ? 'Backing up…' : 'Back up now'}
          detail={last ? `Last backup ${ago(last)}` : 'Never backed up — do it once a week'}
          onClick={busy ? undefined : () => void doBackup()}
        />
        <ListRow icon="restore" title="Restore from a backup" detail="Pick a Noor-backup file from Files" onClick={() => input.current?.click()} />
      </List>
      <p className="n-hint">
        A backup holds everything: prayer settings and your own times, reminders, tasks, special days, cycle data, tasbih, notes and photos on
        Home. Keep it in iCloud Drive so it survives a lost phone.
      </p>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Sheet
        open={!!pending}
        onClose={() => !busy && setPending(null)}
        title="Restore backup"
        actions={
          <button className="n-link n-link--strong n-link--danger" disabled={busy} onClick={() => void doRestore()}>
            {busy ? 'Restoring…' : 'Restore'}
          </button>
        }
      >
        <div className="n-restore">
          <NIcon name="restore" size={34} />
          <strong>
            Backup from{' '}
            {when && !Number.isNaN(+when)
              ? when.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : 'an unknown date'}
          </strong>
          <p>Everything in Noor now will be replaced by this backup. Noor restarts when it’s done.</p>
        </div>
      </Sheet>
    </>
  );
}
