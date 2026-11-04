import { useMemo, useState } from 'react';
import {
  ARABIC_WEEKDAYS, BANGLA_MONTHS, BANGLA_WEEKDAYS, HIJRI_MONTHS_AR, MONTHS_EN, WEEKDAYS_SHORT, banglaLong, banglaSeason, cal, hijriAr, hijriEn, occasionName, parseYmd,
  toAr, toBn, ymd, type DayInfo, type OccasionKind, type SpecialDay, type SpecialInput,
} from '../calendar';
import { useNoor } from '../context';
import { useLoad, useToday } from '../hooks';
import { NIcon } from '../icons';
import { List, SectionTitle } from '../ui';
import { eveningPhase, PHASE_NAME, visibility } from '../moon';
import { MoonIcon } from '../MoonIcon';
import { SpecialSheet, blankSpecial } from './SpecialSheet';

const KIND_LABEL: Record<OccasionKind, string> = { holiday: 'Public holiday', islamic: 'Islamic occasion', fasting: 'Sunnah fast', special: 'Special day' };
const KIND_ICON = { holiday: 'sparkle', islamic: 'moon', fasting: 'moon', special: 'gift' } as const;

function monthSpan(days: DayInfo[]): { bn: string; ar: string } {
  if (!days.length) return { bn: '', ar: '' };
  const a = days[0];
  const b = days[days.length - 1];
  const bn = a.bangla.month === b.bangla.month ? BANGLA_MONTHS[a.bangla.month - 1] : `${BANGLA_MONTHS[a.bangla.month - 1]}–${BANGLA_MONTHS[b.bangla.month - 1]}`;
  const ar = a.hijri.month === b.hijri.month ? HIJRI_MONTHS_AR[a.hijri.month - 1] : `${HIJRI_MONTHS_AR[a.hijri.month - 1]} – ${HIJRI_MONTHS_AR[b.hijri.month - 1]}`;
  return { bn: `${bn} ${toBn(b.bangla.year)}`, ar: `${ar} ${toAr(b.hijri.year)}` };
}

export function CalendarScreen() {
  const { push } = useNoor();
  const today = useToday();
  const t = parseYmd(today);
  const [ym, setYm] = useState({ y: t.getFullYear(), m: t.getMonth() + 1 });
  const [selected, setSelected] = useState(today);
  const [editing, setEditing] = useState<SpecialInput | null>(null);

  const { data: days } = useLoad(() => cal.month(ym.y, ym.m), [ym.y, ym.m], ['calendar']);
  const { data: specials } = useLoad(() => cal.specials(), [], ['calendar']);

  const list = days ?? [];
  const span = monthSpan(list);
  const sel = list.find((d) => d.date === selected) ?? null;
  const lead = list[0]?.weekday ?? 0;

  const shift = (n: number) => {
    const d = new Date(ym.y, ym.m - 1 + n, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() + 1 });
    setSelected(ymd(d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() ? t : d));
  };
  const goToday = () => {
    setYm({ y: t.getFullYear(), m: t.getMonth() + 1 });
    setSelected(today);
  };

  const monthEvents = useMemo(() => list.flatMap((d) => d.occasions.filter((o) => o.kind !== 'fasting').map((o) => ({ d, o }))), [list]);

  const editSpecial = (s: SpecialDay) => setEditing({ ...s });
  const addOn = (d: DayInfo | null) => {
    const base = d ? parseYmd(d.date) : t;
    setEditing(blankSpecial(base.getMonth() + 1, base.getDate()));
  };

  return (
    <div className="n-screen n-calendar">
      <header className="n-calhead">
        <div>
          <div className="n-eyebrow n-calhead__sub">
            <span lang="bn">{span.bn}</span>
            <span lang="ar">{span.ar}</span>
          </div>
          <h1 className="n-title">
            {MONTHS_EN[ym.m - 1]} <span className="n-title__year">{ym.y}</span>
          </h1>
        </div>
        <div className="n-calhead__nav">
          <button className="n-iconbtn n-iconbtn--lg" onClick={() => shift(-1)} aria-label="Previous month">
            <NIcon name="chevronLeft" size={20} stroke={2.2} />
          </button>
          {(ym.y !== t.getFullYear() || ym.m !== t.getMonth() + 1) && (
            <button className="n-iconbtn n-iconbtn--lg n-iconbtn--text" onClick={goToday} aria-label="Today">
              Today
            </button>
          )}
          <button className="n-iconbtn n-iconbtn--lg" onClick={() => shift(1)} aria-label="Next month">
            <NIcon name="chevronRight" size={20} stroke={2.2} />
          </button>
        </div>
      </header>

      <div className="n-grid">
        {WEEKDAYS_SHORT.map((w, i) => (
          <div key={w} className={`n-grid__wd ${i === 5 ? 'is-fri' : ''}`}>
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {list.map((d) => {
          const n = +d.date.slice(8);
          const kinds = [...new Set(d.occasions.map((o) => o.kind))];
          const holiday = kinds.includes('holiday');
          const sp = d.occasions.find((o) => o.kind === 'special');
          const color = sp?.userId ? specials?.find((s) => s.id === sp.userId)?.color : undefined;
          return (
            <button
              key={d.date}
              className={`n-cell ${d.date === today ? 'is-today' : ''} ${d.date === selected ? 'is-sel' : ''} ${holiday ? 'is-holiday' : ''} ${d.weekday === 5 ? 'is-fri' : ''}`}
              onClick={() => setSelected(d.date)}
              aria-label={`${n} ${MONTHS_EN[ym.m - 1]}${d.occasions.length ? ', ' + d.occasions.map((o) => o.en).join(', ') : ''}`}
            >
              <MoonIcon phase={eveningPhase(d.date)} size={9} className="n-cell__moon" />
              <b>{n}</b>
              <span className="n-cell__alt">
                <i lang="bn">{toBn(d.bangla.day)}</i>
                <i lang="ar">{toAr(d.hijri.day)}</i>
              </span>
              <span className="n-cell__dots">
                {kinds.slice(0, 3).map((k) => (
                  <em key={k} className={`k-${k}`} style={k === 'special' && color ? { background: color } : undefined} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="n-legend">
        <span>
          <i className="k-holiday" /> Holiday
        </span>
        <span>
          <i className="k-islamic" /> Islamic
        </span>
        <span>
          <i className="k-fasting" /> Fast
        </span>
        <span>
          <i className="k-special" /> Yours
        </span>
        <span className="n-legend__nums">
          <b lang="bn">বাংলা</b> · <b lang="ar">هجري</b>
        </span>
      </div>

      {sel && (
        <section className="n-daypanel">
          <div className="n-daypanel__head">
            <div>
              <strong>{parseYmd(sel.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
              <span lang="bn">
                {BANGLA_WEEKDAYS[sel.weekday]}, {banglaLong(sel.bangla)} · {banglaSeason(sel.bangla)}
              </span>
              <span lang="ar" dir="rtl">
                {ARABIC_WEEKDAYS[sel.weekday]}، {hijriAr(sel.hijri)}
              </span>
              <small>{hijriEn(sel.hijri)}</small>
            </div>
            <button className="n-chip" onClick={() => addOn(sel)}>
              <NIcon name="plus" size={14} stroke={2.4} /> Add
            </button>
          </div>
          <MoonRow date={sel.date} />
          {sel.occasions.length === 0 ? (
            <p className="n-daypanel__none">No holidays or special days. Tap Add to remember something on this date.</p>
          ) : (
            <div className="n-daypanel__occ">
              {sel.occasions.map((o) => {
                const s = o.userId ? specials?.find((x) => x.id === o.userId) : undefined;
                return (
                  <div key={o.key} className={`n-occ n-occ--${o.kind}`} onClick={s ? () => editSpecial(s) : undefined} role={s ? 'button' : undefined}>
                    <NIcon name={KIND_ICON[o.kind]} size={16} />
                    <span>
                      <b>{occasionName(o)}</b>
                      <small>
                        {o.bn ? <span lang="bn">{o.bn}</span> : KIND_LABEL[o.kind]}
                        {o.ar && <span lang="ar"> · {o.ar}</span>}
                        {s?.alert && ` · 🔔 ${s.alertTime}`}
                      </small>
                    </span>
                    {s && <NIcon name="edit" size={15} />}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {monthEvents.length > 0 && (
        <>
          <SectionTitle>This month</SectionTitle>
          <List>
            {monthEvents.map(({ d, o }) => (
              <div key={`${d.date}${o.key}`} className="n-row n-occrow" onClick={() => setSelected(d.date)} role="button">
                <span className={`n-datechip n-datechip--${o.kind}`}>
                  <b>{+d.date.slice(8)}</b>
                  <i>{WEEKDAYS_SHORT[d.weekday]}</i>
                </span>
                <span className="n-row__text">
                  <span className="n-row__title">{occasionName(o)}</span>
                  <span className="n-row__detail">{o.bn ? <span lang="bn">{o.bn}</span> : KIND_LABEL[o.kind]}</span>
                </span>
              </div>
            ))}
          </List>
        </>
      )}

      <SectionTitle
        action={
          <button className="n-link" onClick={() => push({ kind: 'calendar-settings' })}>
            Settings
          </button>
        }
      >
        My special days
      </SectionTitle>
      <button className="n-add" onClick={() => addOn(null)}>
        <span className="n-add__plus">
          <NIcon name="plus" size={20} stroke={2.4} />
        </span>
        New special day
      </button>
      {specials && specials.length > 0 && (
        <List>
          {specials.map((s) => (
            <div key={s.id} className="n-row n-occrow" onClick={() => editSpecial(s)} role="button">
              <span className="n-sp__dot" style={{ background: s.color }} />
              <span className="n-row__text">
                <span className="n-row__title">{s.title}</span>
                <span className="n-row__detail">
                  {s.calendar === 'hijri' ? `${s.day} ${['Muharram', 'Safar', "Rabi' I", "Rabi' II", 'Jumada I', 'Jumada II', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu'l-Qi'dah", "Dhu'l-Hijjah"][s.month - 1]} (Hijri)` : `${s.day} ${MONTHS_EN[s.month - 1]}`}
                  {s.year === null ? ' · every year' : ` · ${s.year}`}
                  {s.alert ? ` · 🔔 ${s.daysBefore ? `${s.daysBefore}d before, ` : ''}${s.alertTime}` : ''}
                </span>
              </span>
              <NIcon name="chevronRight" size={18} className="n-row__chev" />
            </div>
          ))}
        </List>
      )}

      <SpecialSheet
        value={editing}
        hijri={sel ? { month: sel.hijri.month, day: sel.hijri.day } : undefined}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function MoonRow({ date }: { date: string }) {
  const p = eveningPhase(date);
  const name = PHASE_NAME[p.key];
  return (
    <div className="n-moonrow">
      <MoonIcon phase={p} size={34} />
      <span>
        <b>
          {name.en} · {Math.round(p.illumination * 100)}% lit
        </b>
        <small>
          <span lang="bn">{name.bn}</span> · {p.age.toFixed(1)} days old · {visibility(p)}
        </small>
      </span>
    </div>
  );
}
