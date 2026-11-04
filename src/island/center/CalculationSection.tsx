import { api } from '../lib/ipc';
import { useAutoSave } from '../lib/hooks';
import { formatTime, hhmm } from '../lib/time';
import {
  ALL_PRAYERS,
  PRAYER_NAMES,
  type HighLatitudeRule,
  type ManualTimetable,
  type PrayerCalculationSettings,
  type PrayerSnapshot,
} from '../lib/types';
import { Card, Notice, NumberInput, Row, SaveStatus } from '../components/Field';
import { SourceBadge } from '../components/SourceBadge';

const HIGH_LAT: { id: HighLatitudeRule; label: string }[] = [
  { id: 'middleOfNight', label: 'Middle of the night' },
  { id: 'seventhOfNight', label: 'One-seventh of the night' },
  { id: 'twilightAngle', label: 'Twilight angle based' },
  { id: 'none', label: 'No adjustment' },
];

export function CalculationSection({ snapshot }: { snapshot: PrayerSnapshot }) {
  const calc = useAutoSave<PrayerCalculationSettings>(snapshot.settings.calculation, api.saveCalculation);
  const manual = useAutoSave<ManualTimetable>(snapshot.settings.manual, api.saveManual, 700);
  const c = calc.draft;
  const m = manual.draft;
  if (!c || !m) return null;

  const set = (patch: Partial<PrayerCalculationSettings>) => calc.setDraft((d) => ({ ...d, ...patch }));
  const tz = snapshot.activeLocation.timezone;
  const use24 = snapshot.settings.display.use24Hour;
  const method = snapshot.methods.find((x) => x.id === c.method);
  const isManual = c.mode === 'manual';

  return (
    <div className="section">
      <header className="section__head">
        <h1>
          Calculation <SaveStatus status={calc.status} error={calc.error} />
          <SaveStatus status={manual.status} error={manual.error} />
        </h1>
        <p>Times are recalculated automatically whenever the date, location, time zone or these settings change.</p>
      </header>

      <Card title="Timetable source">
        <div className="seg seg--wide">
          <button className={!isManual ? 'is-on' : ''} onClick={() => set({ mode: 'calculated' })}>
            Calculate automatically
          </button>
          <button className={isManual ? 'is-on' : ''} onClick={() => set({ mode: 'manual' })}>
            Enter times manually
          </button>
        </div>
      </Card>

      {!isManual && (
        <Card title="Method">
          <Row label="Calculation method" hint={method?.description}>
            <select value={c.method} onChange={(e) => set({ method: e.target.value as PrayerCalculationSettings['method'] })}>
              {snapshot.methods.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Row>
          {c.method === 'custom' && (
            <>
              <Row label="Fajr angle">
                <NumberInput value={c.customFajrAngle} min={5} max={25} step={0.1} suffix="°" onChange={(v) => set({ customFajrAngle: v })} />
              </Row>
              <Row label="Isha" hint="Use an angle, or a fixed number of minutes after Maghrib.">
                <div className="inline">
                  <select
                    value={c.customIshaMinutes ? 'minutes' : 'angle'}
                    onChange={(e) => set({ customIshaMinutes: e.target.value === 'minutes' ? 90 : null })}
                  >
                    <option value="angle">Angle</option>
                    <option value="minutes">Minutes after Maghrib</option>
                  </select>
                  {c.customIshaMinutes ? (
                    <NumberInput value={c.customIshaMinutes} min={1} max={240} suffix="min" onChange={(v) => set({ customIshaMinutes: v })} />
                  ) : (
                    <NumberInput value={c.customIshaAngle} min={5} max={25} step={0.1} suffix="°" onChange={(v) => set({ customIshaAngle: v })} />
                  )}
                </div>
              </Row>
            </>
          )}
          <Row label="Asr" hint="Hanafi uses a shadow twice the object’s length, so Asr is later.">
            <div className="seg seg--small">
              <button className={c.asr === 'standard' ? 'is-on' : ''} onClick={() => set({ asr: 'standard' })}>
                Standard
              </button>
              <button className={c.asr === 'hanafi' ? 'is-on' : ''} onClick={() => set({ asr: 'hanafi' })}>
                Hanafi
              </button>
            </div>
          </Row>
          <Row label="High-latitude adjustment" hint="Keeps Fajr and Isha reasonable where twilight lasts all night in summer.">
            <select value={c.highLatitude} onChange={(e) => set({ highLatitude: e.target.value as HighLatitudeRule })}>
              {HIGH_LAT.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </Row>
        </Card>
      )}

      {!isManual ? (
        <Card title={`Minute adjustments — ${snapshot.activeLocation.name}`} actions={<span className="hint">Saved for this location only</span>}>
          <div className="offsets">
            {ALL_PRAYERS.map((p) => {
              const e = snapshot.today.entries.find((x) => x.prayer === p);
              return (
                <div key={p} className="offset">
                  <span>{PRAYER_NAMES[p]}</span>
                  <NumberInput
                    value={c.offsets[p]}
                    min={-120}
                    max={120}
                    width={64}
                    suffix="min"
                    onChange={(v) => set({ offsets: { ...c.offsets, [p]: v } })}
                  />
                  <span className="offset__time">
                    {e?.calculatedTime ? formatTime(e.calculatedTime, tz, use24) : '—'}
                    {e && c.offsets[p] !== 0 && <> → {formatTime(e.time, tz, use24)}</>}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card title={`Fixed times — ${snapshot.activeLocation.name}`} actions={<span className="hint">24-hour, saved for this location only</span>}>
          <Notice>
            These times are used every day. Leave a prayer empty to use its calculated time. Calculated times stay stored
            separately, so you can switch back anytime.
          </Notice>
          <div className="offsets">
            {ALL_PRAYERS.map((p) => {
              const e = snapshot.today.entries.find((x) => x.prayer === p);
              const calcTime = e?.calculatedTime ? hhmm(e.calculatedTime, tz) : '';
              return (
                <div key={p} className="offset">
                  <span>{PRAYER_NAMES[p]}</span>
                  <input
                    type="time"
                    value={m[p] ?? ''}
                    onChange={(ev) => manual.setDraft((d) => ({ ...d, [p]: ev.target.value || null }))}
                  />
                  <span className="offset__time">
                    {m[p] ? (
                      <button className="link-btn" onClick={() => manual.setDraft((d) => ({ ...d, [p]: null }))}>
                        Clear
                      </button>
                    ) : (
                      <>calculated {calcTime || '—'}</>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Today with these settings">
        <div className="tgrid tgrid--light">
          {snapshot.today.entries.map((e) => (
            <div key={e.prayer} className="tcell">
              <div className="tcell__name">
                {PRAYER_NAMES[e.prayer]} <SourceBadge entry={e} />
              </div>
              <div className="tcell__time">{formatTime(e.time, tz, use24)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
