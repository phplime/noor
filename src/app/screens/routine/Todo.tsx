import { useState } from 'react';
import { errorText } from '../../../island/lib/ipc';
import { useWidgetData, w, type Todo } from '../../../island/lib/widgets';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { Empty, SectionTitle } from '../../ui';

export function TodoView() {
  const { flash } = useNoor();
  const { data } = useWidgetData('todo', w.todos);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const open = (data ?? []).filter((t) => !t.done);
  const done = (data ?? []).filter((t) => t.done);
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => flash(errorText(e)));

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    act(() => w.todoAdd(t));
  };

  const commitRename = () => {
    if (!editing) return;
    const t = editing.title.trim();
    setEditing(null);
    if (t) act(() => w.todoRename(editing.id, t));
  };

  const item = (t: Todo) => (
    <div key={t.id} className={`n-todo ${t.done ? 'is-done' : ''}`}>
      <button className="n-check" onClick={() => act(() => w.todoDone(t.id, !t.done))} aria-label={t.done ? 'Mark as not done' : 'Mark as done'}>
        {t.done && <NIcon name="check" size={15} stroke={3} />}
      </button>
      {editing?.id === t.id ? (
        <input
          className="n-input n-todo__edit"
          value={editing.title}
          autoFocus
          onChange={(e) => setEditing({ id: t.id, title: e.target.value })}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === 'Enter' && commitRename()}
        />
      ) : (
        <span className="n-todo__title" onClick={() => !t.done && setEditing({ id: t.id, title: t.title })}>
          {t.title}
        </span>
      )}
      <button className="n-iconbtn n-iconbtn--faint" onClick={() => act(() => w.todoDelete(t.id))} aria-label="Delete">
        <NIcon name="trash" size={17} />
      </button>
    </div>
  );

  return (
    <>
      <form
        className="n-todo-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="n-input" placeholder="Add a task…" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />
        <button className="n-round n-round--accent" type="submit" disabled={!text.trim()} aria-label="Add">
          <NIcon name="plus" size={20} stroke={2.4} />
        </button>
      </form>

      {open.length === 0 && done.length === 0 && (
        <Empty icon="list" title="Nothing to do">
          Quick tasks for today. Tap a task to rename it.
        </Empty>
      )}

      {open.length > 0 && <div className="n-list">{open.map(item)}</div>}

      {done.length > 0 && (
        <>
          <SectionTitle
            action={
              <button className="n-link" onClick={() => act(() => w.todoClearDone())}>
                Clear
              </button>
            }
          >
            Completed · {done.length}
          </SectionTitle>
          <div className="n-list">{done.map(item)}</div>
        </>
      )}
    </>
  );
}
