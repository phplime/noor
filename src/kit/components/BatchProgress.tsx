import { Icon } from './Icon';
import { useApp } from '../app/AppContext';
import { revealInFinder, savedFileActions } from '../services/file-export';
import { isIOS, isMobile, revealLabel } from '../utils/platform';
import type { RunState } from '../hooks/useExportRunner';
import { formatBytes, sizeChange } from '../utils/format';

export function BatchProgress({ state, onCancel, onDismiss, showSizes }: { state: RunState; onCancel: () => void; onDismiss: () => void; showSizes?: boolean }) {
  const { notify } = useApp();
  const { running, total, finished, summary, statuses } = state;
  if (!running && !summary) return null;
  const outputs = [...statuses.values()].filter((u) => u.status === 'done' && u.outputPath).map((u) => u.outputPath!);
  const pct = total ? Math.round((finished / total) * 100) : 0;
  const firstOutput = [...statuses.values()].find((u) => u.status === 'done' && u.outputPath)?.outputPath;

  if (running) {
    return (
      <div className="field" aria-live="polite">
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="small">
            Processing {Math.min(finished + 1, total)} of {total}…
          </span>
          <button className="btn none" onClick={onCancel} title="Cancel (Esc). Files already finished are kept; nothing partial is written.">
            <Icon name="stop" size={12} /> Cancel
          </button>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  const s = summary!;
  const parts = [
    { n: s.succeeded, label: 'saved', color: 'var(--success)' },
    { n: s.skipped, label: 'skipped', color: 'var(--warning)' },
    { n: s.failed, label: 'failed', color: 'var(--danger)' },
    { n: s.cancelled, label: 'cancelled', color: 'var(--warning)' },
  ].filter((p, i) => i === 0 || p.n > 0);
  return (
    <div className="field" aria-live="polite">
      <div className="row" style={{ alignItems: 'center', gap: 6 }}>
        <span className="small" style={{ flex: 1 }}>
          <strong>{s.wasCancelled ? 'Cancelled' : 'Done'}</strong>{' '}
          {parts.map((p, i) => (
            <span key={p.label}>
              {i > 0 && ' · '}
              <span style={{ color: p.n ? p.color : undefined, fontWeight: 600 }}>{p.n}</span> {p.label}
            </span>
          ))}
          <span className="subtle"> · {(s.elapsedMs / 1000).toFixed(1)} s</span>
        </span>
        {firstOutput && !isMobile() && (
          <button className="btn none" onClick={() => void revealInFinder(firstOutput)} title={revealLabel()}>
            <Icon name="folderOpen" size={14} /> Show
          </button>
        )}
        <button className="btn ghost icon none" onClick={onDismiss} title="Dismiss summary" aria-label="Dismiss summary">
          <Icon name="x" size={13} />
        </button>
      </div>
      {isIOS() && outputs.length > 0 && (
        <div className="save-row">
          {savedFileActions(outputs, notify).map((a, i) => (
            <button key={a.label} className={`btn${i === 0 ? ' primary' : ''}`} onClick={a.run}>
              <Icon name={i === 0 ? 'image' : 'folderOpen'} size={14} /> {a.label}
            </button>
          ))}
        </div>
      )}
      {showSizes && s.succeeded > 0 && (
        <div className="small muted">
          Measured: {formatBytes(s.inputBytes)} in → {formatBytes(s.outputBytes)} out
          {s.succeeded === s.total && <> ({sizeChange(s.inputBytes, s.outputBytes)})</>}
        </div>
      )}
    </div>
  );
}
