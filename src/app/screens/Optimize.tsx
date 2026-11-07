import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { errorText } from '../../island/lib/ipc';
import { useNoor } from '../context';
import { NIcon, type NoorIconName } from '../icons';
import { liveEnabled, liveStepsEnabled, setLiveEnabled, setLiveStepsEnabled } from '../live';
import {
  bestOf,
  bytes,
  calmEnabled,
  optimize,
  setCalmEnabled,
  thumbSrc,
  type DeviceHealth,
  type JunkGroup,
  type PhotoItem,
  type PhotoScan,
} from '../optimize';
import { List, ListRow, Page, SectionTitle, Sheet, Switch } from '../ui';

// ---------------------------------------------------------------------------
// Settings › Optimize (iPhone)
//   One "Scan & optimize" button runs five real steps with progress, then shows
//   result tiles. Every delete is chosen by the user and confirmed.
// ---------------------------------------------------------------------------

type StepId = 'device' | 'junk' | 'screenshots' | 'videos' | 'duplicates';
type StepState = 'wait' | 'run' | 'done' | 'skip';
const STEPS: { id: StepId; label: string; icon: NoorIconName }[] = [
  { id: 'device', label: 'Battery, heat & storage', icon: 'flame' },
  { id: 'junk', label: "Noor's junk files", icon: 'trash' },
  { id: 'screenshots', label: 'Screenshots', icon: 'image' },
  { id: 'videos', label: 'Large videos', icon: 'play' },
  { id: 'duplicates', label: 'Duplicate photos', icon: 'layout' },
];
const IDLE: Record<StepId, StepState> = { device: 'wait', junk: 'wait', screenshots: 'wait', videos: 'wait', duplicates: 'wait' };

type Detail = 'junk' | 'duplicates' | 'screenshots' | 'videos' | null;

export function OptimizePage({ onBack }: { onBack: () => void }) {
  const { flash } = useNoor();
  const [device, setDevice] = useState<DeviceHealth | null>(null);
  const [junk, setJunk] = useState<JunkGroup[] | null>(null);
  const [photos, setPhotos] = useState<PhotoScan | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [steps, setSteps] = useState(IDLE);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<Detail>(null);

  useEffect(() => void optimize.device().then(setDevice).catch(() => setDevice({})), []);

  const run = useCallback(async () => {
    setRunning(true);
    setPhotoError(null);
    const s = { ...IDLE };
    const mark = (id: StepId, v: StepState) => {
      s[id] = v;
      setSteps({ ...s });
    };
    try {
      mark('device', 'run');
      setDevice(await optimize.device());
      mark('device', 'done');

      mark('junk', 'run');
      setJunk(await optimize.junkScan());
      mark('junk', 'done');

      const merged: PhotoScan = {};
      for (const part of ['screenshots', 'videos', 'duplicates'] as const) {
        if (merged.error) {
          mark(part, 'skip');
          continue;
        }
        mark(part, 'run');
        const r = await optimize.photosScan(part);
        if (r.error) {
          merged.error = r.error;
          setPhotoError(r.error);
          mark(part, 'skip');
          continue;
        }
        Object.assign(merged, { [part]: r[part], limited: r.limited });
        setPhotos({ ...merged });
        mark(part, 'done');
      }
    } catch (e) {
      flash(errorText(e));
    } finally {
      setRunning(false);
    }
  }, [flash]);

  const scanned = Object.values(steps).some((v) => v === 'done');
  const junkSize = junk?.flatMap((g) => g.files).reduce((a, f) => a + f.size, 0) ?? 0;
  const dupCount = photos?.duplicates?.reduce((a, g) => a + g.length - 1, 0) ?? 0;
  const dupSize = photos?.duplicates?.reduce((a, g) => a + g.filter((i) => i.id !== bestOf(g)).reduce((x, i) => x + i.size, 0), 0) ?? 0;
  const shotSize = photos?.screenshots?.reduce((a, i) => a + i.size, 0) ?? 0;
  const vidSize = photos?.videos?.reduce((a, i) => a + i.size, 0) ?? 0;
  const score = healthScore(device, junkSize, dupCount);

  return (
    <Page title="Optimize" onBack={onBack}>
      <div className="n-stack n-opt">
        <Hero device={device} score={score} steps={steps} running={running} scanned={scanned} onRun={() => void run()} />

        {scanned && (
          <>
            <SectionTitle>Free up space</SectionTitle>
            <div className="n-opt__tiles">
              <Tile icon="trash" tone="teal" title="Junk files" value={bytes(junkSize)} sub={`${junk?.flatMap((g) => g.files).length ?? 0} files in Noor`} onClick={() => setDetail('junk')} />
              <Tile
                icon="layout"
                tone="violet"
                title="Duplicates"
                value={photos?.duplicates ? `${dupCount}` : '—'}
                sub={photos?.duplicates ? `extra copies · ${bytes(dupSize)}` : stepNote(steps.duplicates, photoError)}
                onClick={photos?.duplicates ? () => setDetail('duplicates') : undefined}
              />
              <Tile
                icon="image"
                tone="blue"
                title="Screenshots"
                value={photos?.screenshots ? `${photos.screenshots.length}` : '—'}
                sub={photos?.screenshots ? bytes(shotSize) : stepNote(steps.screenshots, photoError)}
                onClick={photos?.screenshots ? () => setDetail('screenshots') : undefined}
              />
              <Tile
                icon="play"
                tone="rose"
                title="Large videos"
                value={photos?.videos ? `${photos.videos.length}` : '—'}
                sub={photos?.videos ? bytes(vidSize) : stepNote(steps.videos, photoError)}
                onClick={photos?.videos ? () => setDetail('videos') : undefined}
              />
            </div>
            {photoError && <p className="n-hint">{photoErrorText(photoError)}</p>}
            {photos?.limited && <p className="n-hint">Noor sees only the photos you shared with it. Allow Full Access in Settings › Noor › Photos to scan everything.</p>}
          </>
        )}

        <PowerSection />
        <BatteryGuide />
      </div>

      <JunkSheet open={detail === 'junk'} groups={junk} onClose={() => setDetail(null)} onChanged={setJunk} />
      <PhotoSheet kind={detail === 'duplicates' || detail === 'screenshots' || detail === 'videos' ? detail : null} scan={photos} onClose={() => setDetail(null)} onChanged={setPhotos} />
    </Page>
  );
}

// ---------- Health score ----------

function healthScore(d: DeviceHealth | null, junkSize: number, dups: number): number {
  if (!d) return 0;
  let s = 100;
  const b = d.battery ?? 1;
  if (b < 0.1) s -= 25;
  else if (b < 0.2) s -= 15;
  else if (b < 0.4) s -= 5;
  s -= { nominal: 0, fair: 6, serious: 20, critical: 35 }[d.thermal ?? 'nominal'] ?? 0;
  const used = d.total && d.free != null ? 1 - d.free / d.total : 0;
  if (used > 0.95) s -= 25;
  else if (used > 0.9) s -= 15;
  else if (used > 0.8) s -= 6;
  if (junkSize > 200e6) s -= 6;
  else if (junkSize > 20e6) s -= 2;
  if (dups > 50) s -= 6;
  else if (dups > 10) s -= 3;
  if (liveEnabled()) s -= 2;
  if (!calmEnabled()) s -= 2;
  return Math.max(5, Math.min(100, Math.round(s)));
}

const scoreWord = (s: number) => (s >= 85 ? 'Great' : s >= 70 ? 'Good' : s >= 50 ? 'Needs care' : 'Poor');

const THERMAL: Record<string, string> = { nominal: 'Normal', fair: 'Warm', serious: 'Hot', critical: 'Very hot' };

function Hero({
  device,
  score,
  steps,
  running,
  scanned,
  onRun,
}: {
  device: DeviceHealth | null;
  score: number;
  steps: Record<StepId, StepState>;
  running: boolean;
  scanned: boolean;
  onRun: () => void;
}) {
  const done = Object.values(steps).filter((v) => v === 'done' || v === 'skip').length;
  const pct = running ? Math.min(0.98, (done + 0.45) / STEPS.length) : scanned ? 1 : 0;
  const current = STEPS.find((s) => steps[s.id] === 'run');
  const used = device?.total && device.free != null ? 1 - device.free / device.total : null;
  const level = device?.battery ?? null;
  const r = 52;
  const c = 2 * Math.PI * r;

  return (
    <div className={`n-opt__hero ${running ? 'is-running' : ''}`}>
      <div className="n-opt__herotop">
        <div className="n-opt__score">
          <svg width="128" height="128" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r={r} className="n-opt__scoretrack" />
            <circle
              cx="64"
              cy="64"
              r={r}
              className="n-opt__scorebar"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - (running ? pct : score / 100))}
              transform="rotate(-90 64 64)"
            />
          </svg>
          <div className="n-opt__scoretext">
            {running ? (
              <>
                <b>{Math.round(pct * 100)}%</b>
                <small>scanning</small>
              </>
            ) : (
              <>
                <b>{device ? score : '…'}</b>
                <small>{device ? scoreWord(score) : 'checking'}</small>
              </>
            )}
          </div>
        </div>
        <div className="n-opt__herotext">
          <h2>{running ? 'Optimizing…' : scanned ? 'Scan complete' : 'Phone health'}</h2>
          <p>
            {running
              ? current?.label ?? 'Finishing up'
              : scanned
                ? 'Review what was found below. Nothing is deleted until you choose it.'
                : 'Check battery, heat and storage, then find junk, screenshots, big videos and duplicates.'}
          </p>
        </div>
      </div>

      <div className="n-opt__stats">
        <Stat icon="flame" label="Battery" value={level != null ? `${Math.round(level * 100)}%` : '—'} sub={device?.charging === 'charging' ? 'Charging' : device?.lowPower ? 'Low Power' : undefined} />
        <Stat icon="sunrise" label="Heat" value={THERMAL[device?.thermal ?? ''] ?? '—'} warn={device?.thermal === 'serious' || device?.thermal === 'critical'} />
        <Stat icon="layout" label="Free" value={device?.free != null ? bytes(device.free) : '—'} sub={used != null ? `${Math.round(used * 100)}% used` : undefined} warn={used != null && used > 0.9} />
      </div>

      {(running || scanned) && (
        <ol className="n-opt__steps">
          {STEPS.map((s) => (
            <li key={s.id} className={`is-${steps[s.id]}`}>
              <span className="n-opt__stepicon">
                {steps[s.id] === 'done' ? (
                  <NIcon name="check" size={13} stroke={3} />
                ) : steps[s.id] === 'run' ? (
                  <span className="n-opt__spin" />
                ) : steps[s.id] === 'skip' ? (
                  <NIcon name="x" size={12} stroke={3} />
                ) : (
                  <NIcon name={s.icon} size={12} />
                )}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      <div className="n-opt__progress" aria-hidden={!running}>
        <i style={{ width: `${pct * 100}%` }} />
      </div>

      <button className="n-opt__go" onClick={onRun} disabled={running}>
        <NIcon name={running ? 'sliders' : 'sparkle'} size={18} stroke={2.2} />
        {running ? 'Scanning…' : scanned ? 'Scan again' : 'Scan & optimize'}
      </button>
    </div>
  );
}

function Stat({ icon, label, value, sub, warn }: { icon: NoorIconName; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`n-opt__stat ${warn ? 'is-warn' : ''}`}>
      <span>
        <NIcon name={icon} size={13} /> {label}
      </span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Tile({ icon, tone, title, value, sub, onClick }: { icon: NoorIconName; tone: string; title: string; value: string; sub: ReactNode; onClick?: () => void }) {
  return (
    <button className={`n-opt__tile is-${tone}`} onClick={onClick} disabled={!onClick}>
      <span className="n-opt__tileicon">
        <NIcon name={icon} size={18} stroke={2.1} />
      </span>
      <b>{value}</b>
      <span className="n-opt__tiletitle">{title}</span>
      <small>{sub}</small>
      {onClick && <NIcon name="chevronRight" size={16} className="n-opt__tilechev" />}
    </button>
  );
}

const stepNote = (s: StepState, err: string | null) => (s === 'skip' ? (err === 'denied' ? 'No Photos access' : 'Skipped') : s === 'run' ? 'Scanning…' : 'Waiting');
const photoErrorText = (e: string) =>
  e === 'denied'
    ? 'Noor has no access to Photos. Allow it in Settings › Noor › Photos (Full Access), then scan again.'
    : e === 'unsupported'
      ? 'Photos cleanup works on iPhone.'
      : `Couldn't scan Photos: ${e}`;

// ---------- Noor's own battery use ----------

function PowerSection() {
  const [calm, setCalm] = useState(calmEnabled);
  const [live, setLive] = useState(liveEnabled);
  const [steps, setSteps] = useState(liveStepsEnabled);
  const saving = calm && !live;
  return (
    <>
      <SectionTitle>Noor's battery use</SectionTitle>
      <List>
        <ListRow
          icon="sparkle"
          title="Calm mode"
          detail="Keep stars, clouds and sky animations still"
          right={
            <Switch
              checked={calm}
              onChange={(v) => {
                setCalm(v);
                setCalmEnabled(v);
              }}
            />
          }
        />
        <ListRow
          icon="bell"
          title="Lock-screen countdown"
          detail="Live prayer countdown, updates every second"
          right={
            <Switch
              checked={live}
              onChange={(v) => {
                setLive(v);
                setLiveEnabled(v);
              }}
            />
          }
        />
        {live && (
          <ListRow
            icon="heart"
            title="Steps on lock screen"
            detail="Reads the step counter while Noor is open"
            right={
              <Switch
                checked={steps}
                onChange={(v) => {
                  setSteps(v);
                  setLiveStepsEnabled(v);
                }}
              />
            }
          />
        )}
      </List>
      <button
        className={`n-btn ${saving ? 'n-btn--ghost' : 'n-btn--primary'}`}
        disabled={saving}
        onClick={() => {
          setCalm(true);
          setCalmEnabled(true);
          setLive(false);
          setLiveEnabled(false);
        }}
      >
        <NIcon name={saving ? 'check' : 'shield'} size={17} stroke={2.2} />
        {saving ? 'Noor is saving battery' : 'Save battery'}
      </button>
      <p className="n-hint">Prayer alerts still ring with all of these off: they are scheduled with iOS.</p>
    </>
  );
}

// ---------- Other apps: guide ----------

const GUIDE: { title: string; body: string }[] = [
  { title: 'Find the apps', body: 'Open Settings › Battery. Under "Battery usage by app" you see which apps used the most in the last 24 hours or 10 days.' },
  { title: 'Look at background use', body: 'Tap the list once to see Screen and Background time. Lots of background time means an app works while you are not using it.' },
  { title: 'Stop background refresh', body: 'Settings › General › Background App Refresh: turn it off for those apps (or for all apps you rarely use).' },
  { title: 'Limit location', body: 'Settings › Privacy & Security › Location Services: set heavy apps to "While Using" or "Never".' },
  { title: 'Cut needless notifications', body: 'Settings › Notifications: turn off apps that ping you often. Every alert wakes the screen.' },
  { title: 'Still heavy?', body: 'Offload or delete the app (Settings › General › iPhone Storage), and keep iOS up to date.' },
];

function BatteryGuide() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SectionTitle>Other apps draining battery</SectionTitle>
      <div className="n-opt__guide">
        <p>
          iPhone keeps every app in its own sandbox, so Noor can't read other apps' battery use or close them. These steps fix the usual
          culprits in a couple of minutes.
        </p>
        <ol>
          {(open ? GUIDE : GUIDE.slice(0, 2)).map((g, i) => (
            <li key={g.title}>
              <span>{i + 1}</span>
              <div>
                <b>{g.title}</b>
                <p>{g.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <button className="n-link" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : `Show all ${GUIDE.length} steps`}
        </button>
      </div>
    </>
  );
}

// ---------- Junk sheet ----------

function JunkSheet({ open, groups, onClose, onChanged }: { open: boolean; groups: JunkGroup[] | null; onClose: () => void; onChanged: (g: JunkGroup[]) => void }) {
  const { flash } = useNoor();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) setSel(new Set());
  }, [open]);

  const files = useMemo(() => groups?.flatMap((g) => g.files) ?? [], [groups]);
  const selSize = files.filter((f) => sel.has(f.path)).reduce((s, f) => s + f.size, 0);
  const toggle = (p: string) => setSel((s) => (s.has(p) ? (s.delete(p), new Set(s)) : new Set(s.add(p))));

  const clean = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      const freed = await optimize.junkClean([...sel]);
      flash(`Freed ${bytes(freed)}`);
      onChanged(await optimize.junkScan());
      setSel(new Set());
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Junk files" closeLabel="Done">
      <div className="n-opt__sheet">
        {!files.length && <p className="n-hint">Noor is clean. Nothing to remove.</p>}
        {groups
          ?.filter((g) => g.files.length)
          .map((g) => {
            const picked = g.files.filter((f) => sel.has(f.path)).length;
            return (
              <section key={g.id} className="n-opt__jgroup">
                <header>
                  <div>
                    <b>{g.label}</b>
                    <small>{g.detail}</small>
                  </div>
                  <button
                    className="n-chip"
                    onClick={() =>
                      setSel((s) => {
                        const n = new Set(s);
                        g.files.forEach((f) => (picked < g.files.length ? n.add(f.path) : n.delete(f.path)));
                        return n;
                      })
                    }
                  >
                    {picked < g.files.length ? 'Select all' : 'Clear'}
                  </button>
                </header>
                {g.files.map((f) => (
                  <label key={f.path} className={`n-opt__file ${sel.has(f.path) ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={sel.has(f.path)} onChange={() => toggle(f.path)} />
                    <span className="n-opt__fname">{f.name}</span>
                    <span className="n-opt__fsize">{bytes(f.size)}</span>
                  </label>
                ))}
              </section>
            );
          })}
        <DeleteBar count={sel.size} size={selSize} busy={busy} onDelete={() => setConfirm(true)} hint="Tick the files to remove" />
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Delete files?">
        <p>
          Delete <b>{sel.size}</b> file{sel.size === 1 ? '' : 's'} ({bytes(selSize)}) from Noor? This can't be undone.
        </p>
        <button className="n-btn n-btn--danger" onClick={() => void clean()}>
          <NIcon name="trash" size={16} /> Delete {bytes(selSize)}
        </button>
      </Sheet>
    </Sheet>
  );
}

// ---------- Photos sheet ----------

const PHOTO_TITLE = { duplicates: 'Duplicate photos', screenshots: 'Screenshots', videos: 'Large videos' } as const;

function PhotoSheet({
  kind,
  scan,
  onClose,
  onChanged,
}: {
  kind: 'duplicates' | 'screenshots' | 'videos' | null;
  scan: PhotoScan | null;
  onClose: () => void;
  onChanged: (s: PhotoScan) => void;
}) {
  const { flash } = useNoor();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(new Set()), [kind]);

  const items = useMemo(() => {
    const m = new Map<string, PhotoItem>();
    scan?.screenshots?.forEach((i) => m.set(i.id, i));
    scan?.videos?.forEach((i) => m.set(i.id, i));
    scan?.duplicates?.flat().forEach((i) => m.set(i.id, i));
    return m;
  }, [scan]);
  const selSize = [...sel].reduce((s, id) => s + (items.get(id)?.size ?? 0), 0);
  const toggle = (id: string) => setSel((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const list = kind === 'screenshots' ? scan?.screenshots : kind === 'videos' ? scan?.videos : undefined;

  const remove = async () => {
    const ids = [...sel];
    setBusy(true);
    try {
      const r = await optimize.photosDelete(ids);
      if (r === 'ok') {
        flash(`Moved ${ids.length} to Recently Deleted · ${bytes(selSize)}`);
        const gone = new Set(ids);
        if (scan)
          onChanged({
            ...scan,
            screenshots: scan.screenshots?.filter((i) => !gone.has(i.id)),
            videos: scan.videos?.filter((i) => !gone.has(i.id)),
            duplicates: scan.duplicates?.map((g) => g.filter((i) => !gone.has(i.id))).filter((g) => g.length > 1),
          });
        setSel(new Set());
      } else if (r !== 'cancelled') flash(r);
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!kind || !scan) return null;
  return (
    <Sheet open onClose={onClose} title={PHOTO_TITLE[kind]} closeLabel="Done">
      <div className="n-opt__sheet">
        <div className="n-opt__tools">
          {kind === 'duplicates' ? (
            <button
              className="n-chip"
              onClick={() =>
                setSel(() => {
                  const n = new Set<string>();
                  scan.duplicates?.forEach((g) => {
                    const keep = bestOf(g);
                    g.forEach((i) => i.id !== keep && n.add(i.id));
                  });
                  return n;
                })
              }
            >
              <NIcon name="sparkle" size={13} /> Select extras, keep best
            </button>
          ) : (
            <button className="n-chip" onClick={() => setSel(new Set(list?.map((i) => i.id)))}>
              Select all
            </button>
          )}
          {sel.size > 0 && (
            <button className="n-chip" onClick={() => setSel(new Set())}>
              Clear
            </button>
          )}
        </div>

        {kind === 'duplicates' &&
          (scan.duplicates?.length ? (
            scan.duplicates.map((g, gi) => (
              <div key={gi} className="n-opt__dup">
                <div className="n-opt__duphead">
                  {g.length} similar · {bytes(g.reduce((s, i) => s + i.size, 0))}
                </div>
                <Grid items={g} sel={sel} toggle={toggle} best={bestOf(g)} />
              </div>
            ))
          ) : (
            <p className="n-hint">No duplicate photos found.</p>
          ))}
        {kind !== 'duplicates' &&
          (list?.length ? <Grid items={list} sel={sel} toggle={toggle} /> : <p className="n-hint">{kind === 'screenshots' ? 'No screenshots.' : 'No videos over 50 MB.'}</p>)}

        <p className="n-hint">iPhone asks once more before deleting. Deleted items stay in Photos › Recently Deleted for 30 days.</p>
        <DeleteBar count={sel.size} size={selSize} busy={busy} onDelete={() => void remove()} hint="Tap photos to select" />
      </div>
    </Sheet>
  );
}

function DeleteBar({ count, size, busy, onDelete, hint }: { count: number; size: number; busy: boolean; onDelete: () => void; hint: string }) {
  return (
    <div className="n-opt__bar">
      <span>
        {count ? (
          <>
            <b>{count}</b> selected · {bytes(size)}
          </>
        ) : (
          hint
        )}
      </span>
      <button className="n-btn n-btn--danger" disabled={!count || busy} onClick={onDelete}>
        <NIcon name="trash" size={16} /> {busy ? 'Working…' : 'Delete'}
      </button>
    </div>
  );
}

function Grid({ items, sel, toggle, best }: { items: PhotoItem[]; sel: Set<string>; toggle: (id: string) => void; best?: string }) {
  return (
    <div className="n-opt__grid">
      {items.map((i) => {
        const on = sel.has(i.id);
        return (
          <button key={i.id} className={`n-opt__ph ${on ? 'is-on' : ''}`} onClick={() => toggle(i.id)} aria-pressed={on}>
            {i.thumb ? <img src={thumbSrc(i.thumb)} alt="" loading="lazy" /> : <span className="n-opt__noimg" />}
            <span className="n-opt__check">{on && <NIcon name="check" size={14} stroke={3} />}</span>
            {best === i.id && <span className="n-opt__best">Best</span>}
            <span className="n-opt__size">
              {i.duration > 0 ? `${Math.floor(i.duration / 60)}:${String(Math.round(i.duration % 60)).padStart(2, '0')} · ` : ''}
              {bytes(i.size)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
