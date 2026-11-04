import { useState } from 'react';
import { errorText } from '../../island/lib/ipc';
import { PRAYER_NAMES } from '../../island/lib/types';
import { useNoor } from '../context';
import { NIcon } from '../icons';
import { SALAH_PRAYERS, STATUS_INFO, qazaTotal, salah, useSalah, type Qaza, type SalahPrayer, type SalahStatus } from '../salah';
import { Card, SectionTitle, Sheet } from '../ui';

const STATUSES: SalahStatus[] = ['jamaat', 'onTime', 'late', 'missed'];
const BN_PRAYER: Record<string, string> = { fajr: 'ফজর', dhuhr: 'যোহর', asr: 'আসর', maghrib: 'মাগরিব', isha: 'এশা', witr: 'বিতর' };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Small round marker: coloured tick for a marked prayer, a dashed ring when it still needs marking. */
export function SalahDot({ status, size = 22 }: { status: SalahStatus | null; size?: number }) {
  if (!status) return <span className="n-sdot is-empty" style={{ width: size, height: size }} />;
  return (
    <span className="n-sdot" style={{ width: size, height: size, background: STATUS_INFO[status].color }}>
      <NIcon name={status === 'missed' ? 'x' : 'check'} size={size * 0.62} stroke={3} />
    </span>
  );
}

/** Choose how a prayer was prayed. */
export function SalahMarkSheet({ target, onClose }: { target: { date: string; prayer: SalahPrayer; status: SalahStatus | null } | null; onClose: () => void }) {
  const { flash } = useNoor();
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const set = async (s: SalahStatus | null) => {
    setBusy(true);
    try {
      await salah.set(target.date, target.prayer, s);
      if (s === 'missed') flash(`${PRAYER_NAMES[target.prayer]} added to qaza — make it up when you can`);
      else if (s) flash(`${PRAYER_NAMES[target.prayer]} · ${STATUS_INFO[s].en} — Alhamdulillah`);
      onClose();
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const day = new Date(`${target.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Sheet open onClose={onClose} title={`${PRAYER_NAMES[target.prayer]} · ${BN_PRAYER[target.prayer]}`}>
      <p className="n-hint n-hint--flush">{day}</p>
      <div className="n-smark">
        {STATUSES.map((s) => (
          <button key={s} className={`n-smark__opt ${target.status === s ? 'is-on' : ''}`} disabled={busy} onClick={() => void set(s)} style={{ ['--c' as string]: STATUS_INFO[s].color }}>
            <SalahDot status={s} size={30} />
            <b>{STATUS_INFO[s].en}</b>
            <small lang="bn">{STATUS_INFO[s].bn}</small>
          </button>
        ))}
      </div>
      {target.status && (
        <button className="n-btn n-btn--ghost" disabled={busy} onClick={() => void set(null)}>
          <NIcon name="undo" size={18} /> Clear mark
        </button>
      )}
    </Sheet>
  );
}

/** Prayer › Tracker: streaks, the month at a glance, and qaza. */
export function TrackerView() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const first = new Date(ym.y, ym.m, 1);
  const last = new Date(ym.y, ym.m + 1, 0);
  const { data, status } = useSalah(ymd(first), ymd(last));
  const todayData = useSalah(ymd(now), ymd(now));
  const [mark, setMark] = useState<{ date: string; prayer: SalahPrayer; status: SalahStatus | null } | null>(null);
  const [daySel, setDaySel] = useState<string | null>(null);
  const [editQaza, setEditQaza] = useState(false);
  const today = data?.today ?? ymd(now);
  const s = data?.stats;
  const shift = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  const lead = first.getDay();
  const days = Array.from({ length: last.getDate() }, (_, i) => ymd(new Date(ym.y, ym.m, i + 1)));

  return (
    <>
      <div className="n-sstats">
        <div className="n-sstat n-sstat--fire">
          <NIcon name="flame" size={22} />
          <b>{s?.streak ?? 0}</b>
          <small>day streak</small>
        </div>
        <div className="n-sstat">
          <b>{s?.bestStreak ?? 0}</b>
          <small>best streak</small>
        </div>
        <div className="n-sstat">
          <b>{s?.weekPrayed ?? 0}/35</b>
          <small>this week</small>
        </div>
        <div className="n-sstat">
          <b>{s?.onTimePct ?? 0}%</b>
          <small>on time · 30d</small>
        </div>
      </div>

      <SectionTitle>Today</SectionTitle>
      <div className="n-stoday">
        {SALAH_PRAYERS.map((p) => {
          const st = todayData.status(today, p);
          return (
            <button key={p} className="n-stoday__item" onClick={() => setMark({ date: today, prayer: p, status: st })}>
              <SalahDot status={st} size={30} />
              <b>{PRAYER_NAMES[p]}</b>
              <small>{st ? STATUS_INFO[st].en : 'Tap to mark'}</small>
            </button>
          );
        })}
      </div>

      <div className="n-smonth-head">
        <button className="n-iconbtn" onClick={() => shift(-1)} aria-label="Previous month">
          <NIcon name="chevronLeft" size={20} />
        </button>
        <strong>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</strong>
        <button className="n-iconbtn" onClick={() => shift(1)} aria-label="Next month">
          <NIcon name="chevronRight" size={20} />
        </button>
      </div>
      <Card>
        <div className="n-smonth">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <span key={i} className="n-smonth__wd">
              {d}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {days.map((d) => {
            const future = d > today;
            return (
              <button key={d} className={`n-smonth__day ${d === today ? 'is-today' : ''}`} disabled={future} onClick={() => setDaySel(d)}>
                <b>{+d.slice(8)}</b>
                <span className="n-smonth__dots">
                  {SALAH_PRAYERS.map((p) => {
                    const st = status(d, p);
                    return <i key={p} style={st ? { background: STATUS_INFO[st].color } : undefined} />;
                  })}
                </span>
              </button>
            );
          })}
        </div>
        <div className="n-slegend">
          {STATUSES.map((k) => (
            <span key={k}>
              <i style={{ background: STATUS_INFO[k].color }} /> {STATUS_INFO[k].en}
            </span>
          ))}
        </div>
      </Card>

      <QazaCard qaza={data?.qaza ?? null} onEdit={() => setEditQaza(true)} />

      <Sheet open={!!daySel} onClose={() => setDaySel(null)} title={daySel ? new Date(`${daySel}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : ''} closeLabel="Done">
        <div className="n-sdaylist">
          {daySel &&
            SALAH_PRAYERS.map((p) => {
              const st = status(daySel, p);
              return (
                <button key={p} className="n-sdaylist__row" onClick={() => setMark({ date: daySel, prayer: p, status: st })}>
                  <SalahDot status={st} />
                  <b>{PRAYER_NAMES[p]}</b>
                  <small>{st ? STATUS_INFO[st].en : 'Not marked'}</small>
                  <NIcon name="chevronRight" size={16} />
                </button>
              );
            })}
        </div>
      </Sheet>
      <SalahMarkSheet target={mark} onClose={() => setMark(null)} />
      {editQaza && data && <QazaEditSheet qaza={data.qaza} onClose={() => setEditQaza(false)} />}
    </>
  );
}

function QazaCard({ qaza, onEdit }: { qaza: Qaza | null; onEdit: () => void }) {
  const { flash } = useNoor();
  if (!qaza) return null;
  const total = qazaTotal(qaza);
  const rows: (SalahPrayer | 'witr')[] = [...SALAH_PRAYERS, 'witr'];
  const madeUp = async (p: SalahPrayer | 'witr') => {
    try {
      await salah.madeUp(p);
      flash(`One ${p === 'witr' ? 'Witr' : PRAYER_NAMES[p]} qaza made up — MashaAllah`);
    } catch (e) {
      flash(errorText(e));
    }
  };
  return (
    <>
      <div className="n-sectionrow">
        <SectionTitle>Qaza · ক্বাযা</SectionTitle>
        <button className="n-link" onClick={onEdit}>
          Edit
        </button>
      </div>
      <Card>
        <div className="n-qaza__head">
          <div>
            <b>{total}</b>
            <small>{total === 1 ? 'prayer to make up' : 'prayers to make up'}</small>
          </div>
          {qaza.madeUp > 0 && (
            <span className="n-qaza__done">
              <NIcon name="checkCircle" size={16} /> {qaza.madeUp} made up
            </span>
          )}
        </div>
        {total === 0 ? (
          <p className="n-hint n-hint--flush">No qaza owed. Missed prayers you mark are added here automatically; tap Edit to add older ones.</p>
        ) : (
          <div className="n-qaza">
            {rows
              .filter((p) => qaza[p] > 0)
              .map((p) => (
                <div key={p} className="n-qaza__row">
                  <span>
                    <b>{p === 'witr' ? 'Witr' : PRAYER_NAMES[p]}</b> <small lang="bn">{BN_PRAYER[p]}</small>
                  </span>
                  <em>{qaza[p]}</em>
                  <button className="n-chip" onClick={() => void madeUp(p)}>
                    <NIcon name="check" size={14} stroke={2.6} /> Made up 1
                  </button>
                </div>
              ))}
          </div>
        )}
      </Card>
    </>
  );
}

function QazaEditSheet({ qaza, onClose }: { qaza: Qaza; onClose: () => void }) {
  const { flash } = useNoor();
  const [q, setQ] = useState(qaza);
  const [years, setYears] = useState('');
  const rows: (SalahPrayer | 'witr')[] = [...SALAH_PRAYERS, 'witr'];
  const save = async () => {
    try {
      await salah.saveQaza(q);
      flash('Qaza count saved');
      onClose();
    } catch (e) {
      flash(errorText(e));
    }
  };
  const addYears = () => {
    const days = Math.round(Number(years) * 365);
    if (!(days > 0)) return;
    setQ((x) => ({ ...x, fajr: x.fajr + days, dhuhr: x.dhuhr + days, asr: x.asr + days, maghrib: x.maghrib + days, isha: x.isha + days, witr: x.witr + days }));
    setYears('');
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Qaza owed"
      actions={
        <button className="n-link n-link--strong" onClick={() => void save()}>
          Save
        </button>
      }
    >
      <div className="n-form">
        {rows.map((p) => (
          <label key={p} className="n-field n-field--row">
            <span>
              {p === 'witr' ? 'Witr' : PRAYER_NAMES[p]} <small lang="bn">{BN_PRAYER[p]}</small>
            </span>
            <span className="n-stepper">
              <button type="button" onClick={() => setQ((x) => ({ ...x, [p]: Math.max(0, x[p] - 1) }))}>
                −
              </button>
              <input inputMode="numeric" value={q[p]} onChange={(e) => setQ((x) => ({ ...x, [p]: Math.max(0, Math.min(100000, Number(e.target.value.replace(/\D/g, '')) || 0)) }))} />
              <button type="button" onClick={() => setQ((x) => ({ ...x, [p]: x[p] + 1 }))}>
                +
              </button>
            </span>
          </label>
        ))}
        <div className="n-qaza__years">
          <span>Add missed years</span>
          <input className="n-input" inputMode="decimal" placeholder="e.g. 2" value={years} onChange={(e) => setYears(e.target.value)} />
          <button className="n-chip" onClick={addYears}>
            Add
          </button>
        </div>
        <p className="n-hint n-hint--flush">“Add missed years” adds one of each prayer (and Witr) per day — useful for prayers missed before you started praying regularly.</p>
      </div>
    </Sheet>
  );
}
