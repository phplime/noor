import { HOME_CARDS, type HomeLayout } from '../../hooks';
import { NIcon } from '../../icons';
import { Sheet, Switch } from '../../ui';

/** Choose which cards appear on Home and in what order. */
export function HomeEditor({ open, layout, onChange, onClose }: { open: boolean; layout: HomeLayout; onChange: (l: HomeLayout) => void; onClose: () => void }) {
  const info = (id: string) => HOME_CARDS.find((c) => c.id === id)!;
  const move = (i: number, d: -1 | 1) => {
    const order = [...layout.order];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ ...layout, order });
  };
  const toggle = (id: HomeLayout['order'][number], on: boolean) => onChange({ ...layout, hidden: on ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      closeLabel="Done"
      title="Customize Home"
      actions={
        <button className="n-link" onClick={() => onChange({ order: HOME_CARDS.map((c) => c.id), hidden: [] })}>
          Reset
        </button>
      }
    >
      <p className="n-hint">Turn cards on or off and move them up or down. Your Home screen is yours.</p>
      <div className="n-list">
        {layout.order.map((id, i) => (
          <div key={id} className="n-row n-homeedit">
            <span className="n-row__text">
              <span className="n-row__title">{info(id).label}</span>
              <span className="n-row__detail">{info(id).hint}</span>
            </span>
            <button className="n-iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              <NIcon name="arrowUp" size={16} stroke={2.2} />
            </button>
            <button className="n-iconbtn" onClick={() => move(i, 1)} disabled={i === layout.order.length - 1} aria-label="Move down">
              <NIcon name="arrowDown" size={16} stroke={2.2} />
            </button>
            <Switch checked={!layout.hidden.includes(id)} onChange={(v) => toggle(id, v)} />
          </div>
        ))}
      </div>
    </Sheet>
  );
}
