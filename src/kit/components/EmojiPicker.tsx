import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS, recentEmoji, rememberEmoji, searchEmoji } from '../utils/emoji';

/** Popover emoji picker: search, recent, categories. Calls onPick and stays open (Shift-click keeps it; Esc closes). */
export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(() => (recentEmoji().length ? 'recent' : EMOJI_GROUPS[0].id));
  const ref = useRef<HTMLDivElement>(null);
  const recent = useMemo(() => recentEmoji(), []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const list = q.trim() ? searchEmoji(q) : group === 'recent' ? recent : EMOJI_GROUPS.find((g) => g.id === group)!.items.map((i) => i[0]);

  return (
    <div className="emoji-picker" ref={ref} role="dialog" aria-label="Emoji picker" onMouseDown={(e) => e.preventDefault()}>
      <input className="input" placeholder="Search emoji (e.g. heart, party, check)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus onMouseDown={(e) => e.stopPropagation()} />
      {!q.trim() && (
        <div className="emoji-tabs">
          {recent.length > 0 && (
            <button className={group === 'recent' ? 'active' : ''} title="Recently used" onClick={() => setGroup('recent')}>
              🕘
            </button>
          )}
          {EMOJI_GROUPS.map((g) => (
            <button key={g.id} className={group === g.id ? 'active' : ''} title={g.label} onClick={() => setGroup(g.id)}>
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-grid">
        {list.map((e, i) => (
          <button
            key={`${e}-${i}`}
            title={e}
            onClick={(ev) => {
              rememberEmoji(e);
              onPick(e);
              if (!ev.shiftKey) onClose();
            }}
          >
            {e}
          </button>
        ))}
        {list.length === 0 && <div className="small muted" style={{ gridColumn: '1 / -1', padding: 8 }}>No emoji found</div>}
      </div>
      <div className="field-hint">Shift-click to add several</div>
    </div>
  );
}
