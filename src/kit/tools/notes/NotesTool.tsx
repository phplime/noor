import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { EmojiPicker } from '../../components/EmojiPicker';
import { Callout } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useShortcut } from '../../hooks/useShortcut';
import { loadNotes, saveNotes, type Note } from '../../services/creative';
import { AppError } from '../../services/ipc';
import { htmlToText, noteTitle, sanitizeHtml } from '../../utils/sanitize';
import type { ToolProps } from '../../navigation/types';

const NOTE_COLORS = [null, '#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe'];

const newId = () => `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function relativeTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diff = (now.getTime() - ms) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** Run a formatting command on the editor (contentEditable). */
function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value);
}

export default function NotesTool({ active }: ToolProps) {
  const { notify, confirm } = useApp();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    loadNotes()
      .then((n) => {
        const clean = n.map((x) => ({ ...x, html: sanitizeHtml(x.html) }));
        setNotes(clean);
        setSelectedId(clean.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated)[0]?.id ?? null);
      })
      .catch((e) => setLoadError(AppError.from(e).message))
      .finally(() => setLoaded(true));
  }, []);

  const persist = useCallback(
    (next: Note[], immediate = false) => {
      window.clearTimeout(saveTimer.current);
      setSaveState('saving');
      const run = () =>
        saveNotes(next)
          .then(() => setSaveState('saved'))
          .catch((e) => {
            setSaveState('error');
            notify({ kind: 'error', title: 'Notes not saved', message: AppError.from(e).message });
          });
      if (immediate) void run();
      else saveTimer.current = window.setTimeout(run, 500);
    },
    [notify],
  );

  // Flush pending changes when leaving the tool or closing the window.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        void saveNotes(notesRef.current);
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  // Load the selected note into the editor (only when switching notes).
  useEffect(() => {
    if (editor.current) editor.current.innerHTML = selected?.html ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loaded]);

  const update = (id: string, patch: Partial<Note>, immediate = false) => {
    const next = notesRef.current.map((n) => (n.id === id ? { ...n, ...patch, updated: Date.now() } : n));
    setNotes(next);
    persist(next, immediate);
  };

  const onInput = () => {
    if (!selected || !editor.current) return;
    const html = editor.current.innerHTML;
    update(selected.id, { html, title: noteTitle(html) });
  };

  const createNote = () => {
    const now = Date.now();
    const n: Note = { id: newId(), title: 'New note', html: '', pinned: false, color: null, created: now, updated: now };
    const next = [n, ...notesRef.current];
    setNotes(next);
    setSelectedId(n.id);
    persist(next, true);
    setQuery('');
    window.setTimeout(() => editor.current?.focus(), 0);
  };

  const deleteNote = async (n: Note) => {
    const ok = await confirm({ title: `Delete “${n.title}”?`, message: 'This note will be permanently deleted.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    const next = notesRef.current.filter((x) => x.id !== n.id);
    setNotes(next);
    setSelectedId(next[0]?.id ?? null);
    persist(next, true);
  };

  useShortcut('mod+n', createNote, active);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...notes]
      .filter((n) => !q || n.title.toLowerCase().includes(q) || htmlToText(n.html).toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
  }, [notes, query]);

  const keepSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    editor.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const fmt = (cmd: string, value?: string) => () => {
    restoreSelection();
    exec(cmd, value);
    onInput();
  };

  const checklist = () => {
    restoreSelection();
    exec('insertUnorderedList');
    const sel = window.getSelection();
    let node: Node | null = sel?.anchorNode ?? null;
    while (node && node !== editor.current && (node as Element).tagName !== 'UL') node = node.parentNode;
    if (node && (node as Element).tagName === 'UL') (node as Element).classList.toggle('checklist');
    onInput();
  };

  const highlight = () => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    exec('insertHTML', `<span class="hl">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</span>`);
    onInput();
  };

  const insertEmoji = (e: string) => {
    restoreSelection();
    exec('insertText', e);
    keepSelection();
    onInput();
  };

  const copyText = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(htmlToText(selected.html));
      notify({ kind: 'success', title: 'Note copied as plain text' });
    } catch {
      notify({ kind: 'error', title: 'Could not copy to the clipboard' });
    }
  };

  const tb = (icon: React.ReactNode, title: string, action: () => void) => (
    <button className="btn ghost icon" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={action}>
      {icon}
    </button>
  );

  if (loadError) {
    return (
      <div className="page">
        <div className="page-narrow">
          <Callout kind="danger">{loadError}</Callout>
        </div>
      </div>
    );
  }

  return (
    <div className="notes-layout">
      <ToolbarActions active={active}>
        <span className="small muted">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : notes.length ? 'All changes saved' : ''}</span>
        <button className="btn primary" onClick={createNote} title="New note (⌘N)">
          <Icon name="plus" /> New Note
        </button>
      </ToolbarActions>

      <aside className="notes-list">
        <div style={{ padding: 10 }}>
          <input className="input" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
        </div>
        <div className="notes-items" role="listbox" aria-label="Notes">
          {visible.map((n) => (
            <button key={n.id} role="option" aria-selected={n.id === selectedId} className={`note-item${n.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(n.id)}>
              <span className="note-dot" style={{ background: n.color ?? 'transparent', borderColor: n.color ? 'transparent' : 'var(--border-strong)' }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="note-title truncate">
                  {n.pinned && '📌 '}
                  {n.title}
                </span>
                <span className="note-snippet truncate">
                  <span className="subtle">{relativeTime(n.updated)}</span> {htmlToText(n.html).split('\n').slice(1).join(' ').slice(0, 80) || 'No additional text'}
                </span>
              </span>
            </button>
          ))}
          {loaded && visible.length === 0 && <div className="small muted" style={{ padding: 16 }}>{query ? 'No notes match your search.' : 'No notes yet.'}</div>}
        </div>
      </aside>

      <section className="notes-editor-wrap">
        {!selected ? (
          <div className="dropzone" style={{ borderStyle: 'solid' }}>
            <div className="big-icon">
              <Icon name="text" size={26} />
            </div>
            <h2>Keep quick notes</h2>
            <p>Headings, lists, checklists, highlights and emoji 😊. Notes are saved on this Mac automatically.</p>
            <button className="btn primary large" onClick={createNote}>
              <Icon name="plus" /> New Note
            </button>
          </div>
        ) : (
          <>
            <div className="notes-toolbar" role="toolbar" aria-label="Formatting">
              {tb(<strong>B</strong>, 'Bold (⌘B)', fmt('bold'))}
              {tb(<em>I</em>, 'Italic (⌘I)', fmt('italic'))}
              {tb(<u>U</u>, 'Underline (⌘U)', fmt('underline'))}
              {tb(<s>S</s>, 'Strikethrough', fmt('strikeThrough'))}
              <span className="tb-sep" />
              {tb(<span className="tb-text">H1</span>, 'Title', fmt('formatBlock', 'h1'))}
              {tb(<span className="tb-text">H2</span>, 'Heading', fmt('formatBlock', 'h2'))}
              {tb(<span className="tb-text">¶</span>, 'Body text', fmt('formatBlock', 'p'))}
              <span className="tb-sep" />
              {tb(<span className="tb-text">•</span>, 'Bulleted list', fmt('insertUnorderedList'))}
              {tb(<span className="tb-text">1.</span>, 'Numbered list', fmt('insertOrderedList'))}
              {tb(<span className="tb-text">☑︎</span>, 'Checklist', checklist)}
              {tb(<span className="tb-text">❝</span>, 'Quote', fmt('formatBlock', 'blockquote'))}
              {tb(<span className="tb-text mono">{'</>'}</span>, 'Code block', fmt('formatBlock', 'pre'))}
              {tb(<span className="tb-text hl">A</span>, 'Highlight selected text', highlight)}
              <span className="tb-sep" />
              <span style={{ position: 'relative' }}>
                {tb(<span style={{ fontSize: 16 }}>😊</span>, 'Insert emoji', () => {
                  keepSelection();
                  setEmojiOpen((o) => !o);
                })}
                {emojiOpen && (
                  <div style={{ position: 'absolute', top: 32, left: -140 }}>
                    <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
                  </div>
                )}
              </span>
              <span style={{ flex: 1 }} />
              <div className="note-colors" title="Note color">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c ?? 'none'}
                    aria-label={c ? `Color ${c}` : 'No color'}
                    className={selected.color === c ? 'active' : ''}
                    style={{ background: c ?? 'var(--bg-panel)' }}
                    onClick={() => update(selected.id, { color: c }, true)}
                  />
                ))}
              </div>
              {tb(<span style={{ fontSize: 14 }}>{selected.pinned ? '📌' : '📍'}</span>, selected.pinned ? 'Unpin' : 'Pin to top', () => update(selected.id, { pinned: !selected.pinned }, true))}
              {tb(<Icon name="compare" />, 'Copy as plain text', () => void copyText())}
              {tb(<Icon name="trash" />, 'Delete note', () => void deleteNote(selected))}
            </div>
            <div
              ref={editor}
              className="notes-editor"
              style={selected.color ? { boxShadow: `inset 4px 0 0 ${selected.color}` } : undefined}
              contentEditable
              suppressContentEditableWarning
              spellCheck
              role="textbox"
              aria-multiline="true"
              aria-label="Note text"
              data-placeholder="Start typing… The first line becomes the title."
              onInput={onInput}
              onKeyUp={keepSelection}
              onMouseUp={keepSelection}
              onBlur={() => {
                keepSelection();
                persist(notesRef.current, true);
              }}
              onPaste={(e) => {
                e.preventDefault();
                const html = e.clipboardData.getData('text/html');
                const text = e.clipboardData.getData('text/plain');
                if (html) exec('insertHTML', sanitizeHtml(html));
                else exec('insertText', text);
                onInput();
              }}
              onClick={(e) => {
                // Toggle checklist items by clicking their checkbox area.
                const li = (e.target as HTMLElement).closest('ul.checklist > li') as HTMLElement | null;
                if (li && e.nativeEvent.offsetX < 22) {
                  li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
                  if (li.dataset.checked === 'false') delete li.dataset.checked;
                  onInput();
                }
              }}
            />
            <div className="notes-footer small subtle">
              Created {new Date(selected.created).toLocaleString()} · {htmlToText(selected.html).length} characters
            </div>
          </>
        )}
      </section>
    </div>
  );
}
