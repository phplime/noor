import { memo, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Checkbox } from './Field';
import { getThumbnail } from '../services/image-processing';
import { FORMAT_INFO } from '../services/file-export';
import type { ImportQueue } from '../hooks/useImportQueue';
import type { ItemUpdate, ScannedFile } from '../types/engine';
import { formatBytes, formatDims } from '../utils/format';
import { IOS_EXPORT_LOCATION, isMobile } from '../utils/platform';

/** Thumbnail that is only generated once it scrolls into view. */
export const LazyThumb = memo(function LazyThumb({ path, size = 40 }: { path: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [alpha, setAlpha] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        getThumbnail(path, 128)
          .then((t) => {
            if (!cancelled) {
              setSrc(t.dataUrl);
              setAlpha(t.hasAlpha);
            }
          })
          .catch(() => !cancelled && setFailed(true));
      }
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [path]);
  return (
    <div ref={ref} className={`thumb${alpha ? ' checker' : ''}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" draggable={false} /> : <Icon name={failed ? 'alert' : 'image'} size={16} />}
    </div>
  );
});

function StatusIcon({ u }: { u?: ItemUpdate }) {
  if (!u) return null;
  if (u.status === 'processing') return <span className="spinner" aria-label="Processing" />;
  const icon = u.status === 'done' ? 'check' : u.status === 'failed' ? 'alert' : 'x';
  return (
    <span className={`status-icon ${u.status}`} title={u.message ?? u.status}>
      <Icon name={icon} size={15} />
    </span>
  );
}

interface FileQueueProps {
  queue: ImportQueue;
  statuses?: Map<string, ItemUpdate>;
  busy?: boolean;
  title?: string;
  showSubfolderToggle?: boolean;
}

export function FileQueue({ queue, statuses, busy, title = 'Images', showSubfolderToggle = true }: FileQueueProps) {
  const { files, selected, setSelected, remove, clear, addFiles, addFolder, includeSubfolders, setIncludeSubfolders, scanning } = queue;
  // iPhone: no folders to walk, so no subfolder toggle or "add folder" button.
  const ios = isMobile();
  return (
    <div className="queue" style={{ height: '100%' }}>
      <div className="queue-header">
        <span className="title">{title}</span>
        <span className="badge">{files.length}</span>
        {scanning && <span className="spinner" aria-label="Scanning" />}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {showSubfolderToggle && !ios && (
            <Checkbox checked={includeSubfolders} onChange={setIncludeSubfolders} label={<span className="small">Include subfolders</span>} title="When adding a folder, also add images from its subfolders" />
          )}
          <button className="btn ghost icon" title="Add images (⌘O)" onClick={addFiles} disabled={busy}>
            <Icon name="plus" />
          </button>
          {!ios && (
            <button className="btn ghost icon" title="Add folder (⇧⌘O)" onClick={addFolder} disabled={busy}>
              <Icon name="folder" />
            </button>
          )}
          <button
            className="btn ghost icon"
            title="Clear list"
            disabled={busy || !files.length}
            onClick={clear}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <div className="queue-list" role="listbox" aria-label={title}>
        {files.map((f) => (
          <QueueRow key={f.path} file={f} selected={f.path === selected} status={statuses?.get(f.path)} busy={busy} onSelect={() => setSelected(f.path)} onRemove={() => remove(f.path)} />
        ))}
      </div>
    </div>
  );
}

const QueueRow = memo(function QueueRow({ file, selected, status, busy, onSelect, onRemove }: { file: ScannedFile; selected: boolean; status?: ItemUpdate; busy?: boolean; onSelect: () => void; onRemove: () => void }) {
  return (
    <div className={`queue-item${selected ? ' selected' : ''}`} role="option" aria-selected={selected} onClick={onSelect}>
      <LazyThumb path={file.path} />
      <div style={{ minWidth: 0 }}>
        <div className="file-name truncate" title={file.path}>
          {file.name}
        </div>
        <div className="file-meta">
          <span>{formatDims(file.width, file.height)}</span>
          <span>{FORMAT_INFO[file.format].label}</span>
          <span>{formatBytes(file.size)}</span>
          {file.relDir && (
            <span className="truncate" title={`Subfolder: ${file.relDir}`}>
              <Icon name="folder" size={11} style={{ verticalAlign: -1 }} /> {file.relDir}
            </span>
          )}
          {status?.status === 'done' && status.outputW && (
            <span style={{ color: 'var(--success)' }}>
              → {formatDims(status.outputW, status.outputH)} · {formatBytes(status.outputBytes)}
            </span>
          )}
          {(status?.status === 'failed' || status?.status === 'skipped') && <span style={{ color: status.status === 'failed' ? 'var(--danger)' : 'var(--warning)' }} className="truncate" title={status.message ?? ''}>{status.message}</span>}
        </div>
      </div>
      <StatusIcon u={status} />
      <button
        className="btn ghost icon remove"
        title="Remove from list"
        aria-label={`Remove ${file.name}`}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
});

export function EmptyDrop({ queue, title, description, multiple = true }: { queue: ImportQueue; title: string; description: string; multiple?: boolean }) {
  const ios = isMobile();
  return (
    <div className="dropzone">
      <div className="big-icon">
        <Icon name="upload" size={26} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button className="btn primary large" onClick={queue.addFiles}>
          <Icon name="image" /> {ios ? 'Choose from Photos' : multiple ? 'Choose Images…' : 'Open Image…'}
        </button>
        {(multiple || ios) && (
          <button className="btn large" onClick={queue.addFolder}>
            <Icon name="folder" /> {ios ? 'Choose from Files' : 'Choose Folder…'}
          </button>
        )}
      </div>
      {ios ? (
        <p className="small subtle">PNG, JPEG, WebP, BMP, TIFF, GIF · results are saved to {IOS_EXPORT_LOCATION}</p>
      ) : (
        <p className="small subtle">
          or drag and drop {multiple ? 'images or folders' : 'an image'} here · PNG, JPEG, WebP, BMP, TIFF, GIF
        </p>
      )}
      {multiple && !ios && (
        <Checkbox checked={queue.includeSubfolders} onChange={queue.setIncludeSubfolders} label="Include images in subfolders" />
      )}
    </div>
  );
}

export function DragOverlay({ show, label = 'Drop to add images' }: { show: boolean; label?: string }) {
  if (!show) return null;
  return <div className="drag-over-overlay">{label}</div>;
}
