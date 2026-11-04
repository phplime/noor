import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText } from '../../island/lib/ipc';
import { useNow } from '../../island/lib/hooks';
import { splitTime } from '../format';
import { addDays, formatDateLabel, formatShort, formatTime, localDate } from '../../island/lib/time';
import { PRAYER_NAMES, type DailyPrayerSchedule, type Prayer, type PrayerSnapshot, type PrayerTimeEntry } from '../../island/lib/types';
import { PrayerTimeSheet, isCustom } from './PrayerTimeSheet';
import { SalahDot, SalahMarkSheet, TrackerView } from './SalahTracker';
import { activeMakruh, makruhWindows } from '../makruh';
import { dayTimes, tahajjud } from '../periods';
import { cal } from '../calendar';
import { useLoad } from '../hooks';
import { useSalah, type SalahPrayer, type SalahStatus } from '../salah';
import { useNoor, type PrayerTab } from '../context';
import { NIcon, type NoorIconName } from '../icons';
import { QuranHome } from './Quran';
import { DuasView } from './routine/Duas';
import { TasbihView } from './routine/Tasbih';
import { NamazShikkha } from './NamazShikkha';
import { compassPoint, hijriDate, kaabaDistanceKm, qiblaBearing } from '../islamic';
import { Card, List, ListRow, Screen, SectionTitle, Segmented, Switch } from '../ui';

type View = 'day' | 'tracker' | 'month' | 'qibla';

const SECTIONS: { id: PrayerTab; label: string; icon: NoorIconName }[] = [
  { id: 'prayer', label: 'Prayer', icon: 'mosque' },
  { id: 'quran', label: 'Quran', icon: 'book' },
  { id: 'dua', label: 'Dua', icon: 'moonStar' },
  { id: 'tasbih', label: 'Tasbih', icon: 'sparkle' },
  { id: 'shikkha', label: 'নামাজ শিক্ষা', icon: 'flag' },
];

export function PrayerScreen() {
  const { snapshot, prayerTab, setPrayerTab } = useNoor();
  const [view, setView] = useState<View>('day');
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('.is-on')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [prayerTab]);
  return (
    <Screen
      eyebrow={snapshot ? `${snapshot.activeLocation.name} · ${hijriDate()}` : 'Prayer times'}
      title={prayerTab === 'shikkha' ? 'নামাজ শিক্ষা' : prayerTab === 'prayer' ? 'Prayer' : SECTIONS.find((s) => s.id === prayerTab)!.label}
    >
      <div className="n-chipbar" role="tablist" ref={bar}>
        {SECTIONS.map((i) => (
          <button key={i.id} role="tab" aria-selected={prayerTab === i.id} className={`n-chipbar__item ${prayerTab === i.id ? 'is-on' : ''}`} onClick={() => setPrayerTab(i.id)} lang={i.id === 'shikkha' ? 'bn' : undefined}>
            <NIcon name={i.icon} size={17} stroke={prayerTab === i.id ? 2.2 : 1.9} />
            <span>{i.label}</span>
          </button>
        ))}
      </div>
      {prayerTab === 'quran' && <QuranHome />}
      {prayerTab === 'dua' && <DuasView />}
      {prayerTab === 'tasbih' && <TasbihView />}
      {prayerTab === 'shikkha' && <NamazShikkha />}
      {prayerTab === 'prayer' && (
        <PrayerTimes snapshot={snapshot} view={view} setView={setView} />
      )}
    </Screen>
  );
}

function PrayerTimes({ snapshot, view, setView }: { snapshot: PrayerSnapshot | null; view: View; setView: (v: View) => void }) {
  return (
    <>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { id: 'day', label: 'Times' },
          { id: 'tracker', label: 'Tracker' },
          { id: 'month', label: 'Month' },
          { id: 'qibla', label: 'Qibla' },
        ]}
      />
      {!snapshot ? (
        <div className="n-muted n-pad">Loading…</div>
      ) : (
        <>
          {view === 'day' && <DayView snapshot={snapshot} />}
          {view === 'tracker' && <TrackerView />}
          {view === 'month' && <MonthView snapshot={snapshot} />}
          {view === 'qibla' && <QiblaView snapshot={snapshot} />}
          <PrayerSettingsLinks snapshot={snapshot} />
        </>
      )}
    </>
  );
}

function DayView({ snapshot }: { snapshot: PrayerSnapshot }) {
  const { flash, reloadPrayer } = useNoor();
  const now = useNow(1000);
  const tz = snapshot.activeLocation.timezone;
  const use24 = snapshot.settings.display.use24Hour;
  const today = snapshot.today.date;
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<DailyPrayerSchedule | null>(snapshot.today);
  const notif = snapshot.settings.notifications;
  const marks = useSalah(date, date);
  const [marking, setMarking] = useState<{ date: string; prayer: SalahPrayer; status: SalahStatus | null } | null>(null);

  useEffect(() => {
    if (date === today) {
      setDay(snapshot.today);
      return;
    }
    let alive = true;
    api
      .schedule(date)
      .then((d) => alive && setDay(d))
      .catch((e) => flash(errorText(e)));
    return () => {
      alive = false;
    };
  }, [date, today, snapshot, flash]);

  const toggle = async (prayer: Prayer, enabled: boolean) => {
    const next = {
      ...notif,
      masterEnabled: enabled ? true : notif.masterEnabled,
      prayers: notif.prayers.map((p) => (p.prayer === prayer ? { ...p, enabled } : p)),
    };
    try {
      await api.saveNotifications(next);
      await reloadPrayer();
      flash(enabled ? `${PRAYER_NAMES[prayer]} reminders on 🔔` : `${PRAYER_NAMES[prayer]} reminders off`);
    } catch (e) {
      flash(errorText(e));
    }
  };

  const [editing, setEditing] = useState<PrayerTimeEntry | null>(null);
  const [resetting, setResetting] = useState(false);
  const resetAll = async () => {
    setResetting(true);
    try {
      for (const e of day?.entries.filter(isCustom) ?? []) await api.adjustPrayer(e.prayer, { kind: 'reset' });
      await reloadPrayer();
      flash('All jamaat times removed');
    } catch (e) {
      flash(errorText(e));
    } finally {
      setResetting(false);
    }
  };

  const setMaster = async (v: boolean) => {
    try {
      await api.saveNotifications({ ...notif, masterEnabled: v });
      await reloadPrayer();
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <>
      <div className="n-daynav">
        <button className="n-iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          <NIcon name="chevronLeft" size={20} />
        </button>
        <button className="n-daynav__label" onClick={() => setDate(today)}>
          {date === today ? 'Today' : formatDateLabel(date, true)}
          {date !== today && <small>Back to today</small>}
        </button>
        <button className="n-iconbtn" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
          <NIcon name="chevronRight" size={20} />
        </button>
      </div>

      <div className="n-list n-prayers">
        {day?.entries
          .filter((e) => snapshot.settings.display.showSunrise || e.prayer !== 'sunrise')
          .map((e) => {
            const t = Date.parse(e.time);
            const cfg = notif.prayers.find((p) => p.prayer === e.prayer);
            const on = notif.masterEnabled && !!cfg?.enabled;
            const isToday = date === today;
            const future = t > now;
            const past = isToday && !future;
            const trackable = e.prayer !== 'sunrise' && (date < today || past);
            const mark = trackable ? marks.status(date, e.prayer) : null;
            const nextOne =
              isToday &&
              future &&
              day.entries.filter((x) => x.prayer !== 'sunrise' && Date.parse(x.time) > now)[0]?.prayer === e.prayer;
            const tm = splitTime(formatTime(e.time, tz, use24));
            return (
              <div key={e.prayer} className={`n-prayer ${nextOne ? 'is-next' : ''} ${past ? 'is-past' : ''}`}>
                {trackable ? (
                  <button
                    className="n-prayer__state n-prayer__mark"
                    onClick={() => setMarking({ date, prayer: e.prayer as SalahPrayer, status: mark })}
                    aria-label={`Mark ${PRAYER_NAMES[e.prayer]} as prayed`}
                  >
                    <SalahDot status={mark} size={22} />
                  </button>
                ) : (
                  <span className="n-prayer__state">{past ? <NIcon name="check" size={15} stroke={2.6} /> : nextOne ? <i /> : <b />}</span>
                )}
                <div className="n-prayer__main">
                  <div className="n-prayer__name">
                    {PRAYER_NAMES[e.prayer]}
                    {e.jamaat && (
                      <span className="n-tag n-tag--j">
                        Jamaat {formatTime(e.jamaat, tz, use24)}
                      </span>
                    )}
                    {e.offsetMinutes !== 0 && e.source !== 'manual' && (
                      <span className="n-tag">
                        {e.offsetMinutes > 0 ? '+' : ''}
                        {e.offsetMinutes}m
                      </span>
                    )}
                  </div>
                  {nextOne && <div className="n-prayer__sub">in {formatShort((t - now) / 1000)}</div>}
                </div>
                <button className={`n-prayer__time n-prayer__edit ${isCustom(e) ? 'is-custom' : ''}`} onClick={() => setEditing(e)} aria-label={`Edit ${PRAYER_NAMES[e.prayer]} time`}>
                  {tm.t}
                  {tm.p && <small>{tm.p}</small>}
                  <NIcon name="edit" size={13} stroke={2} />
                </button>
                <button className={`n-bell ${on ? 'is-on' : ''}`} onClick={() => void toggle(e.prayer, !on)} aria-label={on ? 'Turn reminders off' : 'Turn reminders on'}>
                  <NIcon name={on ? 'bell' : 'bellOff'} size={18} />
                </button>
              </div>
            );
          })}
      </div>

      {day && (() => {
        const wins = makruhWindows(day.entries);
        const act = date === today ? activeMakruh(wins, now) : null;
        const hm = (ms: number) => formatTime(new Date(ms).toISOString(), tz, use24);
        return (
          <div className="n-makruh">
            <div className="n-makruh__head">
              <NIcon name="info" size={16} stroke={2.2} />
              <b>No-salah times</b> <span lang="bn">নিষিদ্ধ সময়</span>
              <MakruhBell />
            </div>
            <div className="n-makruh__list">
              {wins.map((w) => (
                <span key={w.key} className={act?.key === w.key ? 'is-now' : ''}>
                  <small>
                    {w.en} · <i lang="bn">{w.bn}</i>
                  </small>
                  <b>
                    {hm(w.start)} – {hm(w.end)}
                  </b>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {day && (() => {
        const t = dayTimes([day]);
        if (!t) return null;
        const n = tahajjud(t, t.fajr + 1);
        const hm = (ms: number) => formatTime(new Date(ms).toISOString(), tz, use24);
        const live = date === today && now >= n.start && now < n.end;
        return (
          <div className="n-makruh n-night">
            <div className="n-makruh__head">
              <NIcon name="moon" size={16} stroke={2.2} />
              <b>Night prayer</b> <span lang="bn">রাতের নামাজ</span>
            </div>
            <div className="n-makruh__list">
              <span className={live ? 'is-now' : ''}>
                <small>
                  Tahajjud · <i lang="bn">তাহাজ্জুদ</i>
                </small>
                <b>
                  {hm(n.start)} – {hm(n.end)}
                </b>
              </span>
              <span>
                <small>
                  Midnight · <i lang="bn">মধ্যরাত</i>
                </small>
                <b>{hm(n.midnight)}</b>
              </span>
            </div>
            <p className="n-night__note">Best in the last third of the night, until Fajr begins.</p>
          </div>
        );
      })()}

      <p className="n-hint n-prayers__hint">Tap the circle to mark a prayer as prayed · tap a time to set your mosque’s jamaat time.</p>
      <SalahMarkSheet target={marking} onClose={() => setMarking(null)} />
      {day?.entries.some(isCustom) && (
        <button className="n-btn n-btn--ghost" disabled={resetting} onClick={() => void resetAll()}>
          <NIcon name="reset" size={18} /> Remove all jamaat times
        </button>
      )}
      <PrayerTimeSheet entry={editing} tz={tz} use24={use24} onClose={() => setEditing(null)} />

      <List>
        <ListRow icon="bell" title="Prayer notifications" detail={notif.masterEnabled ? 'On — with sound, even when Noor is closed' : 'Off'} right={<Switch checked={notif.masterEnabled} onChange={(v) => void setMaster(v)} />} />
      </List>
    </>
  );
}

function MonthView({ snapshot }: { snapshot: PrayerSnapshot }) {
  const { flash } = useNoor();
  const tz = snapshot.activeLocation.timezone;
  const use24 = snapshot.settings.display.use24Hour;
  const today = snapshot.today.date;
  const [ym, setYm] = useState(today.slice(0, 7));
  const [rows, setRows] = useState<DailyPrayerSchedule[]>([]);

  useEffect(() => {
    const [y, m] = ym.split('-').map(Number);
    let alive = true;
    api
      .month(y, m)
      .then((r) => alive && setRows(r))
      .catch((e) => flash(errorText(e)));
    return () => {
      alive = false;
    };
  }, [ym, snapshot, flash]);

  const shift = (d: number) => {
    const [y, m] = ym.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    setYm(t.toISOString().slice(0, 7));
  };
  const title = useMemo(() => {
    const [y, m] = ym.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  }, [ym]);
  const cols: Prayer[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const short = (iso: string) => formatTime(iso, tz, use24).replace(/\s?[AP]M$/i, '');

  return (
    <>
      <div className="n-daynav">
        <button className="n-iconbtn" onClick={() => shift(-1)} aria-label="Previous month">
          <NIcon name="chevronLeft" size={20} />
        </button>
        <div className="n-daynav__label">{title}</div>
        <button className="n-iconbtn" onClick={() => shift(1)} aria-label="Next month">
          <NIcon name="chevronRight" size={20} />
        </button>
      </div>
      <Card className="n-month">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              {cols.map((c) => (
                <th key={c}>{c === 'sunrise' ? 'Sun' : PRAYER_NAMES[c].slice(0, 3)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className={r.date === today ? 'is-today' : ''}>
                <td>{formatDateLabel(r.date).replace(/^(\w+),\s*/, '$1 ').replace(/\s\w+$/, '')}</td>
                {cols.map((c) => {
                  const e = r.entries.find((x) => x.prayer === c);
                  return <td key={c}>{e ? short(e.time) : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="n-hint">Times for {snapshot.activeLocation.name} ({tz}).</div>
    </>
  );
}

function QiblaView({ snapshot }: { snapshot: PrayerSnapshot }) {
  const { activeLocation: loc } = snapshot;
  const bearing = qiblaBearing(loc.latitude, loc.longitude);
  const km = kaabaDistanceKm(loc.latitude, loc.longitude);
  const [heading, setHeading] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const on = (e: DeviceOrientationEvent) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      if (typeof ev.webkitCompassHeading === 'number') setHeading(ev.webkitCompassHeading);
      else if (e.absolute && e.alpha !== null) setHeading(360 - e.alpha);
    };
    window.addEventListener('deviceorientation', on, true);
    return () => window.removeEventListener('deviceorientation', on, true);
  }, []);

  const start = async () => {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    try {
      if (D.requestPermission) {
        const r = await D.requestPermission();
        if (r !== 'granted') setMsg('Motion access was denied — use the bearing below with any compass.');
      }
    } catch {
      setMsg('The compass is not available here — use the bearing below.');
    }
  };

  // Needle angle relative to where the phone points.
  const needle = heading === null ? bearing : (bearing - heading + 360) % 360;
  const aligned = heading !== null && (needle < 4 || needle > 356);

  return (
    <Card className={`n-qibla ${aligned ? 'is-aligned' : ''}`}>
      <div className="n-qibla__dial" style={{ transform: heading === null ? undefined : `rotate(${-heading}deg)` }}>
        {['N', 'E', 'S', 'W'].map((d, i) => (
          <span key={d} className={`n-qibla__cardinal n-qibla__cardinal--${i}`}>
            {d}
          </span>
        ))}
        <div className="n-qibla__kaaba" style={{ transform: `rotate(${bearing}deg)` }}>
          <span>🕋</span>
        </div>
      </div>
      <div className="n-qibla__needle" />
      <div className="n-qibla__info">
        <div className="n-qibla__deg">
          {Math.round(bearing)}° <small>{compassPoint(bearing)}</small>
        </div>
        <div className="n-muted">
          {aligned ? 'You are facing the Qibla' : heading === null ? 'Qibla bearing from true north' : `Turn ${needle < 180 ? 'right' : 'left'} ${Math.round(needle < 180 ? needle : 360 - needle)}°`}
        </div>
        <div className="n-muted">{Math.round(km).toLocaleString()} km to Makkah · {loc.name}</div>
        {heading === null && (
          <button className="n-btn n-btn--ghost" onClick={() => void start()}>
            <NIcon name="compass" size={18} /> Use compass
          </button>
        )}
        {msg && <div className="n-hint">{msg}</div>}
      </div>
    </Card>
  );
}

function PrayerSettingsLinks({ snapshot }: { snapshot: PrayerSnapshot }) {
  const { push } = useNoor();
  const s = snapshot.settings;
  const method = snapshot.methods.find((m) => m.id === s.calculation.method)?.name ?? s.calculation.method;
  const reminders = s.notifications.prayers.reduce((n, p) => n + (p.enabled ? p.reminders.filter((r) => r.enabled).length : 0), 0);
  return (
    <>
      <SectionTitle>Prayer settings</SectionTitle>
      <List>
        <ListRow icon="bell" title="Reminders & sounds" detail={s.notifications.masterEnabled ? `${reminders} reminders · before, at or after each prayer` : 'Off'} onClick={() => push({ kind: 'prayer-settings', section: 'reminders' })} />
        <ListRow icon="pin" title="Location" detail={`${snapshot.activeLocation.name}${snapshot.activeLocation.country ? `, ${snapshot.activeLocation.country}` : ''}`} onClick={() => push({ kind: 'prayer-settings', section: 'location' })} />
        <ListRow icon="sliders" title="Calculation" detail={`${method} · Asr ${s.calculation.asr === 'hanafi' ? 'Hanafi' : 'Standard'}`} onClick={() => push({ kind: 'prayer-settings', section: 'calculation' })} />
        <ListRow icon="calendar" title="Adjust times & timetable" detail="Minute offsets, fixed mosque times" onClick={() => push({ kind: 'prayer-settings', section: 'timetable' })} />
        <ListRow icon="today" title="Display" detail={`${s.display.use24Hour ? '24-hour' : '12-hour'} clock · accent colour`} onClick={() => push({ kind: 'prayer-settings', section: 'display' })} />
      </List>
      <div className="n-hint">
        Today at {snapshot.activeLocation.name}: {localDate(Date.now(), snapshot.activeLocation.timezone)} · calculated on your iPhone, nothing is sent anywhere.
      </div>
    </>
  );
}

/** Bell on the no-salah card: alerts when each makruh time starts and ends. */
function MakruhBell() {
  const { flash } = useNoor();
  const { data: s } = useLoad(() => cal.settings(), [], ['calendar']);
  if (!s) return null;
  const on = s.makruhAlerts;
  return (
    <button
      className={`n-bell n-makruh__bell ${on ? 'is-on' : ''}`}
      aria-label={on ? 'Turn no-salah alerts off' : 'Turn no-salah alerts on'}
      onClick={() =>
        void cal
          .saveSettings({ ...s, makruhAlerts: !on })
          .then(() => flash(on ? 'No-salah alerts off' : 'You’ll be notified when no-salah times start and end 🔔'))
          .catch((e) => flash(errorText(e)))
      }
    >
      <NIcon name={on ? 'bell' : 'bellOff'} size={17} />
    </button>
  );
}
