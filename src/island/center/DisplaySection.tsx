import { api } from '../lib/ipc';
import { useAutoSave } from '../lib/hooks';
import type { PrayerDisplaySettings, PrayerSnapshot } from '../lib/types';
import { Card, NumberInput, Row, SaveStatus, Toggle } from '../components/Field';

const ACCENTS = ['#34d399', '#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#f87171'];

export function DisplaySection({ snapshot }: { snapshot: PrayerSnapshot }) {
  const { draft: d, setDraft, status, error } = useAutoSave<PrayerDisplaySettings>(snapshot.settings.display, api.saveDisplay);
  if (!d) return null;
  const set = (patch: Partial<PrayerDisplaySettings>) => setDraft((x) => ({ ...x, ...patch }));

  return (
    <div className="section">
      <header className="section__head">
        <h1>
          Display <SaveStatus status={status} error={error} />
        </h1>
        <p>How prayer times appear in the island.</p>
      </header>

      <Card title="Compact island">
        <Row label="Show next prayer" hint="Name and time of the next prayer next to the notch.">
          <Toggle checked={d.showNextInCompact} onChange={(v) => set({ showNextInCompact: v })} />
        </Row>
        <Row label="Show countdown" hint="Time remaining until the next prayer.">
          <Toggle checked={d.showCountdown} onChange={(v) => set({ showCountdown: v })} />
        </Row>
        <Row
          label="Pre-prayer countdown"
          hint="Highlight the island with a live countdown this many minutes before each prayer (0 = off). The island never opens by itself."
        >
          <NumberInput value={d.prePrayerCountdownMinutes} min={0} max={120} suffix="min" onChange={(v) => set({ prePrayerCountdownMinutes: v })} />
        </Row>
      </Card>

      <Card title="Prayer card">
        <Row label="Highlight upcoming prayer">
          <Toggle checked={d.highlightUpcoming} onChange={(v) => set({ highlightUpcoming: v })} />
        </Row>
        <Row label="Show Sunrise" hint="Sunrise is informational and not a prayer.">
          <Toggle checked={d.showSunrise} onChange={(v) => set({ showSunrise: v })} />
        </Row>
        <Row label="24-hour time">
          <Toggle checked={d.use24Hour} onChange={(v) => set({ use24Hour: v })} />
        </Row>
        <Row label="Card density">
          <div className="seg seg--small">
            <button className={d.cardStyle === 'comfortable' ? 'is-on' : ''} onClick={() => set({ cardStyle: 'comfortable' })}>
              Comfortable
            </button>
            <button className={d.cardStyle === 'compact' ? 'is-on' : ''} onClick={() => set({ cardStyle: 'compact' })}>
              Compact
            </button>
          </div>
        </Row>
        <Row label="Accent colour">
          <div className="inline">
            {ACCENTS.map((a) => (
              <button
                key={a}
                className={`swatch ${d.accent.toLowerCase() === a ? 'is-on' : ''}`}
                style={{ background: a }}
                title={a}
                onClick={() => set({ accent: a })}
              />
            ))}
            <input type="color" value={d.accent} onChange={(e) => set({ accent: e.target.value })} />
          </div>
        </Row>
        <Row label="Open island when a notification is clicked">
          <Toggle checked={d.expandOnNotificationClick} onChange={(v) => set({ expandOnNotificationClick: v })} />
        </Row>
      </Card>
    </div>
  );
}
