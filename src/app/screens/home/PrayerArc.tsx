import { useNow } from '../../../island/lib/hooks';
import type { CSSProperties } from 'react';
import { formatCountdown, formatTime } from '../../../island/lib/time';
import { PRAYER_NAMES, type DailyPrayerSchedule } from '../../../island/lib/types';
import { currentPeriod, dayTimes, PERIOD_BN, tahajjud } from '../../periods';
import { NIcon } from '../../icons';
import { moonPhase, PHASE_NAME } from '../../moon';
import { MoonIcon, MoonShape } from '../../MoonIcon';
import { activeMakruh, makruhWindows } from '../../makruh';
import type { Weather } from '../../weather';

// Home prayer card: a live sky (sun and moon at their real positions, lighting
// the card) with a ring counting down the current prayer period.

const MIN = 60_000;
const HOUR = 60 * MIN;
const LUNAR_DAY = 24.84 * HOUR; // the moon rises ~50 min later each day

// Ring geometry: a 220° gauge, open at the bottom.
const G = { w: 240, h: 176, cx: 120, cy: 112, r: 96, from: 200, sweep: 220 };

function gaugePoint(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [G.cx + G.r * Math.cos(a), G.cy - G.r * Math.sin(a)];
}

function gaugeArc(p: number): string {
  const [x0, y0] = gaugePoint(G.from);
  const [x1, y1] = gaugePoint(G.from - G.sweep * p);
  const large = G.sweep * p > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${G.r} ${G.r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Position across the sky card (percent) for progress 0..1 between rise and set. */
function skyPos(p: number): { x: number; y: number } {
  // A wide dome hugging the card edges, so it clears the ring.
  return { x: 50 - 44 * Math.cos(Math.PI * p), y: 86 - 80 * Math.sin(Math.PI * p) };
}

/** Rough moonrise/moonset around `now`, from the phase (good to about an hour). */
function moonArc(now: number, sunrise: number, fraction: number): { up: number | null; nextRise: number } {
  const rise0 = sunrise + fraction * LUNAR_DAY;
  let nextRise = Infinity;
  for (const k of [-1, 0, 1, 2]) {
    const rise = rise0 + k * LUNAR_DAY;
    const set = rise + LUNAR_DAY / 2;
    if (now >= rise && now <= set) return { up: (now - rise) / (set - rise), nextRise: rise };
    if (rise > now) nextRise = Math.min(nextRise, rise);
  }
  return { up: null, nextRise };
}

const DROPS = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 91.17 + n * 13.37) * 24634.6345) % 1 + 1) % 1;
  return { x: r(1) * 100, d: r(2) * 1.2, t: 0.55 + r(3) * 0.35 };
});

const STARS = Array.from({ length: 28 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: r(1) * 100, y: r(2) * 70, s: 1 + r(3) * 1.6, d: r(4) * 4 };
});

export function PrayerArc({ days, now: _now, tz, use24, location, weather, onOpen }: { days: DailyPrayerSchedule[]; now: number; tz: string; use24: boolean; location: string; weather?: Weather | null; onOpen: () => void }) {
  const now = useNow(1000);
  const today = days[0];
  if (!today) return null;
  const dt = dayTimes(days);
  if (!dt) return null;
  const { fajr, sunrise, maghrib, isha } = dt;
  const cur = currentPeriod(dt, now);
  const progress = Math.min(1, Math.max(0, (now - cur.start) / Math.max(1, cur.end - cur.start)));
  const left = Math.max(0, (cur.end - now) / 1000);

  const prayerList = days.flatMap((d) => d.entries).filter((e) => e.prayer !== 'sunrise');
  const next = prayerList.find((e) => Date.parse(e.time) > now);

  // Sky mood from the sun's place in the day.
  const mood =
    now < fajr || now >= isha
      ? 'night'
      : now < sunrise + 30 * MIN
        ? 'dawn'
        : now < maghrib - 45 * MIN
          ? 'day'
          : now < maghrib + 20 * MIN
            ? 'dusk'
            : 'eve';

  const sunUp = now >= sunrise && now <= maghrib;
  const sun = sunUp ? skyPos((now - sunrise) / (maghrib - sunrise)) : null;
  const phase = moonPhase(new Date(now));
  const ma = moonArc(now, sunrise, phase.fraction);
  const moon = ma.up !== null && phase.illumination > 0.03 ? skyPos(ma.up) : null;
  const dark = mood === 'night' || mood === 'eve';

  // The brightest body lights the card.
  const light = sun ?? moon;
  const style = (light
    ? { '--lx': `${light.x}%`, '--ly': `${light.y}%`, '--lk': sun ? 1 : 0.25 + phase.illumination * 0.45 }
    : { '--lx': '50%', '--ly': '120%', '--lk': 0 }) as CSSProperties;

  const tm = (ms: number) => formatTime(new Date(ms).toISOString(), tz, use24);
  const wx = weather?.kind ?? 'clear';
  const overcast = wx === 'cloudy' || wx === 'rain' || wx === 'drizzle' || wx === 'storm' || wx === 'snow' || wx === 'fog';
  const wet = wx === 'rain' || wx === 'drizzle' || wx === 'storm';
  const makruh = activeMakruh(makruhWindows(today.entries), now);
  const night = tahajjud(dt, now);
  const inTahajjud = now >= night.start && now < night.end;

  return (
    <section className={`n-sky is-${mood} wx-${wx}`} style={style} onClick={onOpen} role="button" tabIndex={0} aria-label={`${cur.en}, ${formatCountdown(left)} left`}>
      <div className="n-sky__bg" aria-hidden="true">
        <div className="n-sky__light" />
        {dark && !overcast && (
          <div className="n-sky__stars">
            {STARS.map((s, i) => (
              <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
            ))}
          </div>
        )}
        {(mood === 'day' || mood === 'dawn' || mood === 'dusk' || overcast) && (
          <>
            <span className="n-sky__cloud c1" />
            <span className="n-sky__cloud c2" />
          </>
        )}
        {overcast && (
          <>
            <span className="n-sky__cloud c3" />
            <span className="n-sky__cloud c4" />
            <span className="n-sky__cloud c5" />
          </>
        )}
        {wx === 'fog' && <div className="n-sky__fog" />}
        {wet && (
          <div className={`n-sky__rain ${wx === 'drizzle' ? 'is-light' : ''}`}>
            {DROPS.map((d, i) => (
              <i key={i} style={{ left: `${d.x}%`, animationDelay: `${d.d}s`, animationDuration: `${d.t}s` }} />
            ))}
          </div>
        )}
        {wx === 'storm' && <div className="n-sky__flash" />}
        {wx === 'snow' && (
          <div className="n-sky__snow">
            {DROPS.slice(0, 26).map((d, i) => (
              <i key={i} style={{ left: `${d.x}%`, animationDelay: `${d.d * 3}s`, animationDuration: `${d.t * 6}s` }} />
            ))}
          </div>
        )}
      </div>

      {dark && (
        <span className="n-sky__moonchip">
          <MoonIcon phase={phase} size={16} />
          {moon
            ? `${PHASE_NAME[phase.key].en} · ${Math.round(phase.illumination * 100)}%`
            : phase.illumination > 0.03
              ? `Moonrise ~${tm(ma.nextRise)}`
              : PHASE_NAME[phase.key].en}
        </span>
      )}

      <div className="n-sky__ring">
        <svg viewBox={`0 0 ${G.w} ${G.h}`} aria-hidden="true">
          <path d={gaugeArc(1)} className="n-sky__track" />
          {progress > 0.004 && <path d={gaugeArc(progress)} className="n-sky__done" />}
        </svg>
        <div className="n-sky__center">
          <strong>{cur.en}</strong>
          <span lang="bn" className="n-sky__bn">{PERIOD_BN[cur.key]}</span>
          <small lang="bn">শেষ হতে বাকি</small>
          <b className="n-mono">{formatCountdown(left)}</b>
        </div>
      </div>

      <div className="n-sky__bodies" aria-hidden="true">
        {moon && (
          <svg className="n-sky__moon" style={{ left: `${moon.x}%`, top: `${moon.y}%` }} viewBox="-20 -20 40 40" width="40" height="40">
            <MoonShape phase={phase} r={11} className={`n-moon--sky ${sun ? 'is-day' : ''}`} />
          </svg>
        )}
        {sun && <span className="n-sky__sun" style={{ left: `${sun.x}%`, top: `${sun.y}%` }} />}
      </div>

      {makruh ? (
        <p className="n-sky__makruh">
          <NIcon name="info" size={14} stroke={2.2} /> Makruh time · <span lang="bn">নিষিদ্ধ সময়</span> — no salah until {tm(makruh.end)}
        </p>
      ) : inTahajjud ? (
        <p className="n-sky__next n-sky__tahajjud">
          🌙 Tahajjud time · <span lang="bn">তাহাজ্জুদের সময়</span> — until Fajr {tm(night.end)}
        </p>
      ) : next && (
        <p className="n-sky__next">
          Next · {PRAYER_NAMES[next.prayer]} {formatTime(next.time, tz, use24)}
          {next.jamaat && <> · Jamaat {formatTime(next.jamaat, tz, use24)}</>}
        </p>
      )}

      <div className="n-sky__pills">
        <span className="n-sky__pill n-sky__pill--loc">
          <NIcon name="pin" size={13} stroke={2.2} />
          <span>{location}</span>
        </span>
        <span className="n-sky__pill">
          <NIcon name="sunrise" size={14} stroke={2} />
          <span lang="bn">সূর্যোদয়</span> <b>{tm(sunrise)}</b>
          <i className="n-sky__sep" />
          <NIcon name="sunset" size={14} stroke={2} />
          <span lang="bn">সূর্যাস্ত</span> <b>{tm(maghrib)}</b>
        </span>
        <span className={`n-sky__pill n-sky__pill--night ${inTahajjud ? 'is-now' : ''}`}>
          <NIcon name="moon" size={13} stroke={2.2} />
          <span lang="bn">তাহাজ্জুদ</span> <b>{tm(night.start)} – {tm(night.end)}</b>
        </span>
      </div>
    </section>
  );
}
