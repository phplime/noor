import { useCallback, useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { errorText } from '../../../island/lib/ipc';
import { useWidgetData } from '../../../island/lib/widgets';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { coordsText, DEFAULT_RADIUS_M, formatDistance, places, type Place, type PlaceStatus } from '../../places';
import { Card, Empty, List, ListRow, SectionTitle, Segmented, Sheet } from '../../ui';
import { PlaceMap, type MapPoint } from './PlaceMap';

interface Draft {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
}

export function PlacesView() {
  const { flash, snapshot } = useNoor();
  const { data } = useWidgetData('places', places.list);
  const list = data ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const [guide, setGuide] = useState<Place | null>(null);
  const [me, setMe] = useState<MapPoint | null>(null);
  const [status, setStatus] = useState<Record<string, PlaceStatus>>({});
  const [focusKey, setFocusKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const watch = useRef<number | null>(null);

  const center: MapPoint = {
    latitude: snapshot?.activeLocation.latitude ?? 23.8103,
    longitude: snapshot?.activeLocation.longitude ?? 90.4125,
  };

  // distances to every place from my position
  useEffect(() => {
    if (!me) return;
    void places
      .status(me.latitude, me.longitude)
      .then((s) => setStatus(Object.fromEntries(s.map((x) => [x.id, x]))))
      .catch(() => undefined);
  }, [me, data]);

  useEffect(() => {
    const stop = () => {
      if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    };
    // Battery: no GPS while Noor is in the background.
    const onVis = () => document.hidden && stop();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, []);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeoNote('Location is not available here.');
      return;
    }
    setLocating(true);
    setGeoNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setMe({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setFocusKey((k) => k + 1);
        if (watch.current === null) {
          watch.current = navigator.geolocation.watchPosition(
            (p) => setMe({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
            () => undefined,
            { enableHighAccuracy: false, maximumAge: 30_000 },
          );
        }
      },
      (err) => {
        setLocating(false);
        setGeoNote(err.code === err.PERMISSION_DENIED ? 'Location is off for Noor — allow it in iOS Settings to see distances.' : 'Could not find your position right now.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  const startDraft = (p: MapPoint) =>
    setDraft({ name: '', latitude: p.latitude, longitude: p.longitude, radiusM: DEFAULT_RADIUS_M });

  return (
    <>
      <Card className="n-mapcard">
        <PlaceMap places={list} center={center} me={me} draft={draft} draftRadius={draft?.radiusM ?? DEFAULT_RADIUS_M} focusKey={focusKey} onTap={startDraft} />
        <div className="n-mapbar">
          <button className="n-chip" onClick={locate} disabled={locating}>
            <NIcon name="compass" size={15} stroke={2} /> {locating ? 'Locating…' : me ? 'Re-centre' : 'My location'}
          </button>
          {me && (
            <button className="n-chip" onClick={() => startDraft(me)}>
              <NIcon name="plus" size={15} stroke={2.4} /> Add place here
            </button>
          )}
          <span className="n-mapbar__hint">{geoNote ?? 'Tap the map to drop a pin'}</span>
        </div>
      </Card>

      {list.length === 0 ? (
        <Empty icon="pin" title="No quiet places yet">
          Pin your mosque, office or classroom. Noor draws the {DEFAULT_RADIUS_M} m circle and walks you through making iOS silence your phone there.
        </Empty>
      ) : (
        <>
          <SectionTitle>Your places</SectionTitle>
          <List>
            {list.map((p) => {
              const st = status[p.id];
              return (
                <ListRow
                  key={p.id}
                  icon="pin"
                  title={p.name}
                  detail={
                    <>
                      {p.radiusM} m{p.automated ? ' · Automatic' : ''}
                      {st && <> · {st.inside ? <b className="n-inside">You’re inside</b> : `${formatDistance(st.distanceM)} away`}</>}
                    </>
                  }
                  right={p.automated ? <span className="n-auto" title="Automatic"><NIcon name="check" size={14} stroke={3} /></span> : <span className="n-warn">Set up</span>}
                  onClick={() => setGuide(p)}
                />
              );
            })}
          </List>
        </>
      )}

      <p className="n-hint">
        iPhone doesn’t let any app switch Silent mode itself. Noor keeps your places and radius, and shows you the one-minute iOS automation (Shortcuts or Focus)
        that turns Do Not Disturb on when you arrive and off when you leave.
      </p>

      {draft && (
        <PlaceSheet
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSaved={(p, isNew) => {
            setDraft(null);
            flash(isNew ? 'Place saved' : 'Place updated');
            if (isNew) setGuide(p);
          }}
        />
      )}
      {guide && <GuideSheet place={guide} onClose={() => setGuide(null)} onEdit={(p) => { setGuide(null); setDraft({ id: p.id, name: p.name, latitude: p.latitude, longitude: p.longitude, radiusM: p.radiusM }); }} />}
    </>
  );
}

function PlaceSheet({ draft, onChange, onClose, onSaved }: { draft: Draft; onChange: (d: Draft) => void; onClose: () => void; onSaved: (p: Place, isNew: boolean) => void }) {
  const { flash } = useNoor();
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  const save = async () => {
    setBusy(true);
    try {
      const p = await places.save(draft);
      onSaved(p, !draft.id);
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id) return;
    try {
      await places.remove(draft.id);
      flash('Place deleted');
      onClose();
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={draft.id ? 'Edit place' : 'New quiet place'}
      actions={
        <button className="n-link n-link--strong" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
          Save
        </button>
      }
    >
      <div className="n-form">
        <input className="n-input n-input--big" placeholder="Name (e.g. Masjid, Office)" value={draft.name} autoFocus={!draft.id} onChange={(e) => set({ name: e.target.value })} />
        <div className="n-field">
          <span>
            Radius · <b className="n-radius">{draft.radiusM} m</b>
          </span>
          <input className="n-range" type="range" min={100} max={2000} step={50} value={draft.radiusM} onChange={(e) => set({ radiusM: Number(e.target.value) })} aria-label="Radius in metres" />
          <div className="n-range__ticks">
            <small>100 m</small>
            <small>500 m</small>
            <small>2 km</small>
          </div>
        </div>
        <p className="n-hint">
          Pin: {coordsText(draft)}. The dashed circle on the map shows the area.
        </p>
        {draft.id && (
          <button className="n-btn n-btn--danger" onClick={() => void remove()}>
            <NIcon name="trash" size={18} /> Delete place
          </button>
        )}
      </div>
    </Sheet>
  );
}

type Method = 'shortcuts' | 'focus';

function GuideSheet({ place, onClose, onEdit }: { place: Place; onClose: () => void; onEdit: (p: Place) => void }) {
  const { flash } = useNoor();
  const [method, setMethod] = useState<Method>('shortcuts');
  const coords = coordsText(place);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coords);
      flash('Coordinates copied');
    } catch {
      flash(coords);
    }
  };
  const openShortcuts = async () => {
    try {
      await openUrl('shortcuts://');
    } catch {
      flash('Open the Shortcuts app on your iPhone');
    }
  };
  const markDone = async (v: boolean) => {
    try {
      await places.setAutomated(place.id, v);
      flash(v ? 'Marked as automatic ✓' : 'Marked as not set up');
      onClose();
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <Sheet open onClose={onClose} closeLabel="Close" title={place.name} actions={<button className="n-link" onClick={() => onEdit(place)}>Edit</button>}>
      <div className="n-stack">
        <div className="n-guide-head">
          <span className="n-row__icon">
            <NIcon name="bellOff" size={18} stroke={2} />
          </span>
          <div>
            <strong>Silence your phone at {place.name}</strong>
            <span>
              Within {place.radiusM} m · {coords}
            </span>
          </div>
        </div>

        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { id: 'shortcuts', label: 'Shortcuts' },
            { id: 'focus', label: 'Focus' },
          ]}
        />
        <p className="n-hint">{method === 'shortcuts' ? 'Recommended — follows your exact radius.' : 'Simplest — iOS chooses the size of the area.'}</p>

        {method === 'shortcuts' ? (
          <ol className="n-steps">
            <li>
              Open <b>Shortcuts</b> › <b>Automation</b> › <b>+</b> › <b>Arrive</b>.
            </li>
            <li>
              Tap <b>Location</b> › <b>Choose</b>, search “{place.name}” or paste the coordinates, check the pin, and drag the circle to about <b>{place.radiusM} m</b>.
            </li>
            <li>
              Set <b>Any Time</b> and <b>Run Immediately</b>, then <b>Next</b>.
            </li>
            <li>
              <b>New Blank Automation</b> › <b>Add Action</b> › <b>Set Focus</b> › Do Not Disturb › <b>Turn On</b> (until turned off). Tap <b>Done</b>.
            </li>
            <li>
              Repeat with <b>Leave</b> and Set Focus › <b>Turn Off</b>, so it ends when you go.
            </li>
          </ol>
        ) : (
          <ol className="n-steps">
            <li>
              Open <b>Settings</b> › <b>Focus</b> › <b>Do Not Disturb</b>.
            </li>
            <li>
              <b>Add Schedule or Automation</b> › <b>Location</b>, then search “{place.name}” or drop the pin at the coordinates.
            </li>
            <li>It switches on when you arrive and off when you leave. iOS chooses the size of the area, so use Shortcuts if you need exactly {place.radiusM} m.</li>
          </ol>
        )}

        <div className="n-guide-actions">
          <button className="n-btn n-btn--ghost" onClick={() => void copy()}>
            <NIcon name="sparkle" size={16} /> Copy coordinates
          </button>
          {method === 'shortcuts' && (
            <button className="n-btn n-btn--ghost" onClick={() => void openShortcuts()}>
              Open Shortcuts
            </button>
          )}
        </div>

        <p className="n-hint">Do Not Disturb silences calls, messages and sounds. Your alarms still ring. To keep Noor’s own reminders, allow Noor in the Focus settings.</p>

        {place.automated ? (
          <button className="n-btn n-btn--ghost" onClick={() => void markDone(false)}>
            Mark as not set up
          </button>
        ) : (
          <button className="n-btn n-btn--primary" onClick={() => void markDone(true)}>
            <NIcon name="check" size={18} stroke={2.6} /> I’ve set it up
          </button>
        )}
      </div>
    </Sheet>
  );
}
