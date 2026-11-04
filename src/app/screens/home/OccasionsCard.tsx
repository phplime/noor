import { NIcon } from '../../icons';
import { daysFromToday, inDays, parseYmd, occasionName, type Dated } from '../../calendar';

const ICON = { holiday: 'sparkle', islamic: 'moon', fasting: 'moon', special: 'gift' } as const;

export function OccasionsCard({ items, onOpen }: { items: Dated[]; onOpen: () => void }) {
  const list = items.slice(0, 4);
  return (
    <div className="n-list n-occlist">
      {list.length === 0 && (
        <div className="n-row n-row--muted" onClick={onOpen} role="button">
          No holidays in the next 2 months — add your own special days in Calendar.
        </div>
      )}
      {list.map((d) => {
        const dt = parseYmd(d.date);
        const n = daysFromToday(d.date);
        const o = d.occasion;
        return (
          <div key={`${d.date}-${o.key}`} className="n-row n-occrow" onClick={onOpen} role="button" tabIndex={0}>
            <span className={`n-datechip n-datechip--${o.kind}`}>
              <b>{dt.getDate()}</b>
              <i>{dt.toLocaleDateString('en-GB', { month: 'short' })}</i>
            </span>
            <span className="n-row__text">
              <span className="n-row__title">{occasionName(o)}</span>
              <span className="n-row__detail">
                {o.bn ? <span lang="bn">{o.bn}</span> : o.kind === 'special' ? 'Your special day' : 'Holiday'}
              </span>
            </span>
            <span className={`n-occin ${n <= 1 ? 'is-soon' : ''}`}>
              <NIcon name={ICON[o.kind]} size={13} stroke={2} /> {inDays(n)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
