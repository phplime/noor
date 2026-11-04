import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../../../island/lib/ipc';
import { useNow } from '../../../island/lib/hooks';
import { useWidgetData, w } from '../../../island/lib/widgets';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { Sheet } from '../../ui';

function diffLabel(min: number): string {
  if (min === 0) return 'Same time';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  const s = `${h ? `${h}h` : ''}${m ? ` ${m}m` : ''}`.trim();
  return min > 0 ? `${s} ahead` : `${s} behind`;
}

export function ClocksView() {
  const { flash, snapshot } = useNoor();
  const { data } = useWidgetData('clock', w.clocks);
  const now = useNow(1000);
  const [adding, setAdding] = useState(false);
  const use24 = snapshot?.settings.display.use24Hour ?? false;

  return (
    <>
      <div className="n-list n-clocks">
        {(data ?? []).map((c) => {
          const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: !use24, timeZone: c.clock.timezone }).format(now);
          const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: c.clock.timezone }).format(now);
          const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: c.clock.timezone }).format(now));
          const night = hour < 6 || hour >= 19;
          return (
            <div key={c.clock.id} className={`n-clock ${night ? 'is-night' : 'is-day'}`}>
              <div className="n-clock__text">
                <div className="n-clock__city">{c.clock.label}</div>
                <div className="n-clock__diff">
                  {day} · {diffLabel(c.diffMin)}
                </div>
              </div>
              <div className="n-clock__time">{time}</div>
              <button className="n-iconbtn n-iconbtn--faint" onClick={() => void w.clockDelete(c.clock.id).catch((e) => flash(errorText(e)))} aria-label={`Remove ${c.clock.label}`}>
                <NIcon name="x" size={16} />
              </button>
            </div>
          );
        })}
      </div>
      {(data?.length ?? 0) < 8 && (
        <button className="n-add" onClick={() => setAdding(true)}>
          <span className="n-add__plus">
            <NIcon name="plus" size={20} stroke={2.4} />
          </span>
          Add a city
        </button>
      )}
      {adding && <AddClock onClose={() => setAdding(false)} />}
    </>
  );
}

function AddClock({ onClose }: { onClose: () => void }) {
  const { flash } = useNoor();
  const [zones, setZones] = useState<string[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    void api.timezones().then((z) => setZones(z.all)).catch(() => undefined);
  }, []);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, '_');
    if (!s) return zones.filter((z) => /^(Asia|Europe|America)\//.test(z)).slice(0, 40);
    return zones.filter((z) => z.toLowerCase().includes(s)).slice(0, 60);
  }, [q, zones]);

  const add = async (tz: string) => {
    try {
      await w.clockAdd('', tz);
      onClose();
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <Sheet open onClose={onClose} title="Add a city">
      <input className="n-input" placeholder="Search city or time zone (e.g. Dubai)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="n-list n-list--scroll">
        {hits.map((z) => (
          <button key={z} className="n-row n-row--tap" onClick={() => void add(z)}>
            <span className="n-row__text">
              <span className="n-row__title">{z.split('/').pop()?.replace(/_/g, ' ')}</span>
              <span className="n-row__detail">{z}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
