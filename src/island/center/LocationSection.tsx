import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../lib/ipc';
import { formatTime } from '../lib/time';
import type { City, PrayerLocation, PrayerSnapshot } from '../lib/types';
import { Card, Notice, Row } from '../components/Field';

const DEVICE_ID = 'device';

export function LocationSection({ snapshot, reload }: { snapshot: PrayerSnapshot; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const active = snapshot.activeLocation;
  const mode = snapshot.settings.locationMode;
  const device = snapshot.locations.find((l) => l.id === DEVICE_ID);
  const saved = snapshot.locations.filter((l) => l.id !== DEVICE_ID);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) setMsg({ kind: 'info', text: ok });
      await reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorText(e) });
    }
  };

  /** Ask iOS for the current position (only when the user asks for it). */
  const locate = () => {
    if (!('geolocation' in navigator)) {
      setMsg({ kind: 'warn', text: 'Location services are not available. Your saved location is used instead.' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void run(
          () => api.setDeviceLocation(pos.coords.latitude, pos.coords.longitude),
          'Using your iPhone’s location. It is stored only on this iPhone.',
        );
      },
      (err) => {
        setLocating(false);
        const denied = err.code === err.PERMISSION_DENIED;
        setMsg({
          kind: 'warn',
          text: denied
            ? 'Location permission was denied. Prayer times keep using your saved location. You can allow Noor in Settings › Privacy & Security › Location Services.'
            : 'Your location could not be determined right now. Prayer times keep using your saved location.',
        });
        void api.setLocationMode('saved').then(reload);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  };

  return (
    <div className="section">
      <header className="section__head">
        <h1>Location</h1>
        <p>Prayer times are calculated on your iPhone from the active location. Nothing is sent to a server.</p>
      </header>
      {msg && (
        <Notice kind={msg.kind}>
          {msg.text}{' '}
          {msg.kind === 'warn' && (
            <button className="link-btn" onClick={() => void api.openSystemSettings('location')}>
              Open Location Services
            </button>
          )}
        </Notice>
      )}

      <Card title="Active location">
        <div className="active-loc">
          <div>
            <div className="active-loc__name">
              {active.name}
              {active.country ? `, ${active.country}` : ''}
            </div>
            <div className="active-loc__meta">
              {active.latitude.toFixed(4)}°, {active.longitude.toFixed(4)}° · {active.timezone} · local time{' '}
              {formatTime(Date.now(), active.timezone, snapshot.settings.display.use24Hour)}
              {active.source === 'device' && ' · from your iPhone'}
            </div>
          </div>
        </div>
        <Row
          label="Use my iPhone’s location"
          hint="Asks for permission only when you turn this on. If it’s denied or unavailable, your saved location is used."
        >
          <div className="inline">
            {mode === 'automatic' ? (
              <>
                <button className="btn" disabled={locating} onClick={locate}>
                  {locating ? 'Locating…' : 'Update'}
                </button>
                <button className="btn" onClick={() => void run(() => api.setLocationMode('saved'))}>
                  Turn off
                </button>
              </>
            ) : (
              <button className="btn btn--accent" disabled={locating} onClick={locate}>
                {locating ? 'Locating…' : device ? 'Use current location' : 'Detect location'}
              </button>
            )}
          </div>
        </Row>
      </Card>

      <Card title="Saved locations">
        <div className="loc-list">
          {saved.map((l) => (
            <div key={l.id} className={`loc ${l.id === active.id ? 'is-active' : ''}`}>
              <div>
                <div className="loc__name">
                  {l.name}
                  {l.country ? `, ${l.country}` : ''}
                </div>
                <div className="loc__meta">
                  {l.latitude.toFixed(4)}°, {l.longitude.toFixed(4)}° · {l.timezone}
                </div>
              </div>
              <div className="inline">
                {l.id === active.id ? (
                  <span className="pill">Default</span>
                ) : (
                  <button className="btn" onClick={() => void run(() => api.setActiveLocation(l.id))}>
                    Use
                  </button>
                )}
                <button
                  className="btn btn--danger"
                  disabled={saved.length <= 1}
                  onClick={() => void run(() => api.deleteLocation(l.id))}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <CitySearch onAdd={(loc, use) => run(() => api.saveLocation(loc, use), `${loc.name} saved.`)} />
      <ManualCoordinates onAdd={(loc, use) => run(() => api.saveLocation(loc, use), `${loc.name} saved.`)} />
    </div>
  );
}

function cityToLocation(c: City): PrayerLocation {
  return {
    id: '',
    name: c.name,
    region: c.region,
    country: c.country,
    latitude: c.latitude,
    longitude: c.longitude,
    timezone: c.timezone,
    elevation: 0,
    source: 'search',
  };
}

function CitySearch({ onAdd }: { onAdd: (l: PrayerLocation, use: boolean) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<City[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => void api.searchLocations(q).then(setResults), 150);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <Card title="Find a city">
      <input
        type="search"
        className="search"
        placeholder="City name, e.g. Dhaka or “London, Canada”"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="hint">Searches an offline list of 7,000+ cities — works offline.</div>
      <div className="results">
        {results.map((c) => (
          <div key={`${c.name}|${c.region}|${c.countryCode}`} className="result">
            <div>
              <strong>{c.name}</strong>
              <span>
                {[c.region, c.country].filter(Boolean).join(', ')} · {c.timezone}
              </span>
            </div>
            <div className="inline">
              <button className="btn" onClick={() => void onAdd(cityToLocation(c), false)}>
                Save
              </button>
              <button className="btn btn--accent" onClick={() => void onAdd(cityToLocation(c), true).then(() => setQ(''))}>
                Save &amp; use
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ManualCoordinates({ onAdd }: { onAdd: (l: PrayerLocation, use: boolean) => Promise<void> }) {
  const [zones, setZones] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [elev, setElev] = useState('0');
  const [tz, setTz] = useState('');

  useEffect(() => {
    void api.timezones().then((z) => {
      setZones(z.all);
      setTz((cur) => cur || z.system);
    });
  }, []);

  const latN = Number(lat);
  const lngN = Number(lng);
  const valid = useMemo(
    () =>
      lat.trim() !== '' &&
      lng.trim() !== '' &&
      Number.isFinite(latN) &&
      Number.isFinite(lngN) &&
      Math.abs(latN) <= 90 &&
      Math.abs(lngN) <= 180 &&
      zones.includes(tz),
    [lat, lng, latN, lngN, tz, zones],
  );

  const loc = (): PrayerLocation => ({
    id: '',
    name: name.trim(),
    region: '',
    country: '',
    latitude: latN,
    longitude: lngN,
    timezone: tz,
    elevation: Math.max(0, Number(elev) || 0),
    source: 'manual',
  });

  return (
    <Card title="Enter coordinates">
      <div className="form-grid">
        <label>
          Name
          <input value={name} placeholder="Home" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Latitude
          <input value={lat} placeholder="23.8103" inputMode="decimal" onChange={(e) => setLat(e.target.value)} />
        </label>
        <label>
          Longitude
          <input value={lng} placeholder="90.4125" inputMode="decimal" onChange={(e) => setLng(e.target.value)} />
        </label>
        <label>
          Elevation (m)
          <input value={elev} inputMode="numeric" onChange={(e) => setElev(e.target.value)} />
        </label>
        <label className="span-2">
          Time zone
          <input list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="inline end">
        {!valid && (lat || lng) && <span className="hint">Latitude −90…90, longitude −180…180 and a valid time zone.</span>}
        <button className="btn" disabled={!valid} onClick={() => void onAdd(loc(), false)}>
          Save
        </button>
        <button className="btn btn--accent" disabled={!valid} onClick={() => void onAdd(loc(), true)}>
          Save &amp; use
        </button>
      </div>
    </Card>
  );
}
