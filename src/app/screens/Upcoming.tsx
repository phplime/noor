import { useEffect, useState } from 'react';
import { noor, type PlannedNotification } from '../api';
import { useNoor } from '../context';
import { NIcon, type NoorIconName } from '../icons';
import { Empty, Page } from '../ui';

const ICON: Record<string, NoorIconName> = { prayer: 'moon', water: 'drop', timer: 'timer', reminder: 'bell', ramadan: 'sunrise', special: 'gift', refresh: 'sparkle', test: 'bell' };
const SOUND: Record<string, string> = {
  default: 'Noor Chime',
  none: 'Silent',
  noor_chime: 'Noor Chime',
  noor_dawn: 'Dawn',
  noor_bell: 'Bell',
  noor_glass: 'Glass',
  noor_soft: 'Soft Marimba',
  noor_pop: 'Pop',
  noor_timer: 'Timer',
};

export function UpcomingPage({ onBack }: { onBack: () => void }) {
  const { snapshot, permission } = useNoor();
  const [list, setList] = useState<PlannedNotification[] | null>(null);
  const use24 = snapshot?.settings.display.use24Hour ?? false;

  useEffect(() => {
    void noor.upcoming().then(setList).catch(() => setList([]));
  }, []);

  // Group by local day.
  const groups = new Map<string, PlannedNotification[]>();
  for (const n of list ?? []) {
    const key = new Date(n.fireAt).toDateString();
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86400_000).toDateString();

  return (
    <Page title="Coming up" onBack={onBack}>
      <div className="n-pad-x">
        <p className="n-hint">
          {permission === 'granted'
            ? 'These are queued with iOS and will ring even if Noor is closed. iOS keeps up to 64 per app, so Noor refreshes the queue every time you open it.'
            : 'Notifications are not allowed yet — these will be scheduled as soon as you allow them.'}
        </p>
        {list && list.length === 0 && <Empty icon="bell" title="Nothing scheduled" />}
        {[...groups.entries()].map(([day, items]) => (
          <div key={day}>
            <div className="n-section">
              <span>{day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : new Date(items[0].fireAt).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}</span>
            </div>
            <div className="n-list">
              {items.map((n, i) => (
                <div className="n-row" key={i}>
                  <span className={`n-row__icon n-kind--${n.kind}`}>
                    <NIcon name={ICON[n.kind] ?? 'bell'} size={16} stroke={2} />
                  </span>
                  <span className="n-row__text">
                    <span className="n-row__title">{n.title}</span>
                    <span className="n-row__detail">
                      {n.body} · 🔊 {SOUND[n.sound] ?? n.sound}
                    </span>
                  </span>
                  <span className="n-row__right n-mono">{new Date(n.fireAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !use24 })}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
