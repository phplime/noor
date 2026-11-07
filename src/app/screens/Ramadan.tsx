import { useEffect, useState } from 'react';
import { errorText } from '../../island/lib/ipc';
import { useNow } from '../../island/lib/hooks';
import { formatCountdown, formatTime } from '../../island/lib/time';
import { noor, type SoundInfo } from '../api';
import { cal, parseYmd, toAr, ymd, type RamadanSettings } from '../calendar';
import { useNoor } from '../context';
import { useLoad } from '../hooks';
import { NIcon } from '../icons';
import { playSound } from '../sound';
import { Page, SectionTitle, Switch } from '../ui';

const WAKE = [0, 15, 30, 45, 60, 90];
const WARN = [0, 5, 10, 15, 20, 30];
const HEADSUP = [0, 5, 10, 15, 30];
const SAFE = [0, 5, 10];

const off = (n: number, unit = 'min') => (n === 0 ? 'Off' : `${n} ${unit}`);

function Pick({ label, hint, value, options, onChange, zeroLabel }: { label: string; hint?: string; value: number; options: number[]; onChange: (n: number) => void; zeroLabel?: string }) {
  return (
    <div className="n-pick">
      <div className="n-pick__text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </div>
      <select className="n-input n-pick__sel" value={value} onChange={(e) => onChange(+e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === 0 ? (zeroLabel ?? 'Off') : off(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RamadanPage({ onBack }: { onBack: () => void }) {
  const { snapshot, flash, permission, askPermission } = useNoor();
  const now = useNow(1000);
  const [sounds, setSounds] = useState<SoundInfo[]>([]);
  const { data: st, reload } = useLoad(() => cal.ramadan(), [], ['ramadan', 'calendar']);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void noor.sounds().then(setSounds).catch(() => undefined);
  }, []);

  const tz = snapshot?.activeLocation.timezone ?? 'UTC';
  const use24 = snapshot?.settings.display.use24Hour ?? false;
  const time = (iso: string) => formatTime(iso, tz, use24);

  const save = async (patch: Partial<RamadanSettings>) => {
    if (!st) return;
    try {
      await cal.ramadanSave({ ...st.settings, ...patch });
    } catch (e) {
      flash(errorText(e));
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      if (permission !== 'granted') await askPermission();
      await noor.refresh();
      reload();
      flash('Ramadan alerts synced ✓');
    } catch (e) {
      flash(errorText(e));
    } finally {
      setSyncing(false);
    }
  };

  if (!st) return <Page title="Ramadan" onBack={onBack}>{null}</Page>;
  const s = st.settings;
  const start = parseYmd(st.start);
  const end = parseYmd(st.end);
  const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const todayRow = st.timetable.find((d) => d.date === ymd(new Date(now)));
  const wakeTime = todayRow ?? st.timetable[0];

  return (
    <Page title="Ramadan" onBack={onBack}>
      <div className="n-pad-x">
        <section className="n-ram n-ram--page">
          <span className="n-ram__glow" aria-hidden="true" />
          <div className="n-ram__top">
            <span className="n-ram__tag">
              <NIcon name="moon" size={14} stroke={2.2} /> Ramadan {st.hijriYear}
            </span>
            <span className="n-ram__ar" lang="ar">
              رمضان {toAr(st.hijriYear)}
            </span>
          </div>
          {st.phase === 'upcoming' ? (
            <div className="n-ram__soon">
              <strong>{st.daysUntil}</strong>
              <span>
                days to go
                <small>{fmtDay(start)}</small>
              </span>
            </div>
          ) : (
            <div className="n-ram__soon">
              <strong>{st.dayNo}</strong>
              <span>
                of {st.timetable.length} days
                <small>{st.daysLeft} left · ends {fmtDay(end)}</small>
              </span>
            </div>
          )}
          {todayRow && (
            <div className="n-ram__times">
              <div>
                <span>Wake up</span>
                <strong>{time(todayRow.wake)}</strong>
              </div>
              <div>
                <span>Sehri ends</span>
                <strong>{time(todayRow.sehriEnd)}</strong>
              </div>
              <div>
                <span>Iftar</span>
                <strong>{time(todayRow.maghrib)}</strong>
              </div>
            </div>
          )}
          {todayRow && now < Date.parse(todayRow.maghrib) && (
            <div className="n-ram__next">
              <NIcon name={now < Date.parse(todayRow.sehriEnd) ? 'sunrise' : 'sunset'} size={20} />
              <span>{now < Date.parse(todayRow.sehriEnd) ? 'Sehri ends in' : 'Iftar in'}</span>
              <strong className="n-mono">{formatCountdown((Date.parse(now < Date.parse(todayRow.sehriEnd) ? todayRow.sehriEnd : todayRow.maghrib) - now) / 1000)}</strong>
            </div>
          )}
        </section>

        <div className="n-card n-stackcard">
          <div className="n-switchrow">
            <span>
              Sync Ramadan every year
              <small>When Ramadan comes round, Sehri and Iftar alerts are scheduled by themselves — nothing to set up again.</small>
            </span>
            <Switch checked={s.enabled} onChange={(v) => void save({ enabled: v })} />
          </div>
          {s.enabled && (
            <div className="n-syncline">
              <NIcon name="check" size={15} stroke={2.6} />
              <span>
                {st.queuedThrough ? `Alerts are queued through ${parseYmd(st.queuedThrough).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : st.phase === 'upcoming' ? `Alerts will start on ${fmtDay(start)}` : 'No alerts queued yet'}
              </span>
              <button className="n-chip" disabled={syncing} onClick={() => void syncNow()}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          )}
          {s.enabled && permission && permission !== 'granted' && (
            <button className="n-btn n-btn--primary" onClick={() => void askPermission()}>
              <NIcon name="bell" size={18} /> Allow notifications
            </button>
          )}
        </div>

        {s.enabled && (
          <>
            <SectionTitle>Sehri</SectionTitle>
            <div className="n-card n-stackcard">
              <Pick label="Wake-up alert" hint="Before Sehri ends" value={s.wakeBeforeMin} options={WAKE} onChange={(n) => void save({ wakeBeforeMin: n })} />
              <Pick label="“Sehri ends soon” alert" hint="Before Sehri ends" value={s.sehriWarningMin} options={WARN} onChange={(n) => void save({ sehriWarningMin: n })} />
              <div className="n-switchrow">
                <span>
                  Alert when Sehri ends
                  <small>The exact end time: your fast begins</small>
                </span>
                <Switch checked={s.sehriEndAlert ?? true} onChange={(v) => void save({ sehriEndAlert: v })} />
              </div>
              <Pick label="Stop eating before Fajr" hint="A safety margin, if you prefer to stop early" value={s.sehriEndBeforeFajrMin} options={SAFE} zeroLabel="At Fajr" onChange={(n) => void save({ sehriEndBeforeFajrMin: n })} />
              <div className="n-field">
                <span>Wake-up sound</span>
                <div className="n-sounds">
                  {sounds.map((x) => (
                    <button
                      key={x.id}
                      className={s.wakeSound === x.id ? 'is-on' : ''}
                      onClick={() => {
                        void save({ wakeSound: x.id });
                        void playSound(x.id);
                      }}
                    >
                      <NIcon name="sound" size={15} />
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <SectionTitle>Iftar</SectionTitle>
            <div className="n-card n-stackcard">
              <Pick label="“Iftar soon” alert" hint="Before Maghrib" value={s.iftarHeadsupMin} options={HEADSUP} onChange={(n) => void save({ iftarHeadsupMin: n })} />
              <div className="n-switchrow">
                <span>
                  Alert at Iftar
                  <small>The moment Maghrib begins</small>
                </span>
                <Switch checked={s.iftarAlert} onChange={(v) => void save({ iftarAlert: v })} />
              </div>
              <div className="n-field">
                <span>Iftar sound</span>
                <div className="n-sounds">
                  {sounds.map((x) => (
                    <button
                      key={x.id}
                      className={s.iftarSound === x.id ? 'is-on' : ''}
                      onClick={() => {
                        void save({ iftarSound: x.id });
                        void playSound(x.id);
                      }}
                    >
                      <NIcon name="sound" size={15} />
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="n-card n-stackcard">
              <div className="n-switchrow">
                <span>
                  Fewer prayer pre-alerts in Ramadan
                  <small>iOS holds up to 64 alerts. Keeping only the at-time prayer alerts lets Sehri and Iftar reach about a week ahead.</small>
                </span>
                <Switch checked={s.leanPrayerAlerts} onChange={(v) => void save({ leanPrayerAlerts: v })} />
              </div>
            </div>
          </>
        )}

        <SectionTitle>Start date</SectionTitle>
        <div className="n-card n-stackcard">
          <p className="n-hint n-hint--flush">
            {st.isEstimate
              ? `Noor estimates Ramadan ${st.hijriYear} will begin around ${fmtDay(start)}. When the moon is sighted and the real date is announced, set it here — alerts move to match.`
              : `You set Ramadan ${st.hijriYear} to begin on ${fmtDay(start)}.`}
          </p>
          <label className="n-field">
            <span>First day of Ramadan</span>
            <input
              className="n-input"
              type="date"
              value={st.start}
              onChange={(e) => e.target.value && void save({ overrideYear: st.hijriYear, overrideStart: e.target.value })}
            />
          </label>
          {!st.isEstimate && (
            <button className="n-btn n-btn--ghost" onClick={() => void save({ overrideYear: null, overrideStart: null })}>
              Use Noor’s estimate again
            </button>
          )}
          <p className="n-hint n-hint--flush">The estimate follows the Hijri day setting in Calendar &amp; holidays (Bangladesh usually −1).</p>
        </div>

        {wakeTime && (
          <>
            <SectionTitle>Must not oversleep?</SectionTitle>
            <div className="n-card n-stackcard">
              <p className="n-hint n-hint--flush">
                Notification sounds follow the Ring/Silent switch and Focus. For a Sehri alarm that always rings, also add a repeating alarm in the Clock app at <strong>{time(wakeTime.wake)}</strong>{' '}
                (it shifts a few minutes through the month — the timetable below has every day).
              </p>
            </div>
          </>
        )}

        <SectionTitle>Timetable</SectionTitle>
        <div className="n-list n-ramtable">
          <div className="n-ramtable__head">
            <span>Day</span>
            <span>Wake</span>
            <span>Sehri</span>
            <span>Iftar</span>
          </div>
          {st.timetable.map((d) => (
            <div key={d.date} className={`n-ramtable__row ${todayRow?.date === d.date ? 'is-today' : ''}`}>
              <span>
                <b>{d.dayNo}</b>
                <small>{parseYmd(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
              </span>
              <span className="n-mono">{time(d.wake)}</span>
              <span className="n-mono">{time(d.sehriEnd)}</span>
              <span className="n-mono">{time(d.maghrib)}</span>
            </div>
          ))}
        </div>
        <p className="n-hint">Times use your prayer settings (location, method, adjustments), so they match the Prayer tab.</p>
      </div>
    </Page>
  );
}
