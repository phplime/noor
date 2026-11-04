import { formatCountdown, formatTime } from '../../../island/lib/time';
import { NIcon } from '../../icons';
import { parseYmd, toAr, type RamadanStatus, ymd } from '../../calendar';
import { splitTime } from '../../format';

/** Sehri / Iftar card for the Home screen. `compact` hides the timetable pieces on small spaces. */
export function RamadanCard({ status, now, tz, use24, onOpen }: { status: RamadanStatus; now: number; tz: string; use24: boolean; onOpen: () => void }) {
  const first = parseYmd(status.start);
  const startLabel = first.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const today = status.timetable.find((d) => d.date === ymd(new Date(now)));

  if (status.phase === 'upcoming' || !today) {
    return (
      <section className="n-ram n-ram--soon" onClick={onOpen} role="button" tabIndex={0}>
        <span className="n-ram__glow" aria-hidden="true" />
        <div className="n-ram__top">
          <span className="n-ram__tag">
            <NIcon name="moon" size={14} stroke={2.2} /> Ramadan {status.hijriYear}
          </span>
          <NIcon name="chevronRight" size={18} />
        </div>
        <div className="n-ram__soon">
          <strong>{status.daysUntil}</strong>
          <span>
            days to Ramadan
            <small>{status.isEstimate ? `Expected around ${startLabel}` : `Starts ${startLabel}`}</small>
          </span>
        </div>
        <p className="n-ram__note">Sehri &amp; Iftar alerts are set up automatically — no need to do anything each year.</p>
      </section>
    );
  }

  const t = (iso: string) => splitTime(formatTime(iso, tz, use24));
  const sehri = t(today.sehriEnd);
  const iftar = t(today.maghrib);
  const tSehri = Date.parse(today.sehriEnd);
  const tIftar = Date.parse(today.maghrib);
  const next =
    now < tSehri
      ? { label: 'Sehri ends in', secs: (tSehri - now) / 1000, icon: 'sunrise' as const }
      : now < tIftar
        ? { label: 'Iftar in', secs: (tIftar - now) / 1000, icon: 'sunset' as const }
        : null;
  const progress = Math.min(1, status.dayNo / status.timetable.length);

  return (
    <section className="n-ram n-ram--on" onClick={onOpen} role="button" tabIndex={0}>
      <span className="n-ram__glow" aria-hidden="true" />
      <div className="n-ram__top">
        <span className="n-ram__tag">
          <NIcon name="moon" size={14} stroke={2.2} /> Ramadan · day {status.dayNo} of {status.timetable.length}
        </span>
        <span className="n-ram__ar" lang="ar">
          {toAr(status.dayNo)} رمضان
        </span>
      </div>
      <div className="n-ram__next">
        {next ? (
          <>
            <NIcon name={next.icon} size={22} />
            <span>{next.label}</span>
            <strong className="n-mono">{formatCountdown(next.secs)}</strong>
          </>
        ) : (
          <>
            <NIcon name="check" size={22} stroke={2.4} />
            <span>Fast complete — taqabbal Allah</span>
          </>
        )}
      </div>
      <div className="n-ram__times">
        <div className={now < tSehri ? 'is-next' : ''}>
          <span>Sehri ends</span>
          <strong>
            {sehri.t}
            {sehri.p && <small>{sehri.p}</small>}
          </strong>
        </div>
        <div className={now >= tSehri && now < tIftar ? 'is-next' : ''}>
          <span>Iftar</span>
          <strong>
            {iftar.t}
            {iftar.p && <small>{iftar.p}</small>}
          </strong>
        </div>
      </div>
      <div className="n-hero__bar">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
    </section>
  );
}
