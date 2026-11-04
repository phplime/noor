import { useEffect, useMemo, useState } from 'react';
import { useNow } from '../../../island/lib/hooks';
import { PRAYER_NAMES } from '../../../island/lib/types';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { playSound } from '../../sound';
import { AFTER_SALAH, DHIKR, loadTasbih, rollDay, saveTasbih, suggestion, tap, targetOf, type TasbihState } from '../../tasbih';
import { SectionTitle, Switch } from '../../ui';

const TARGETS = [33, 34, 99, 100, 0];

export function TasbihView() {
  const { snapshot } = useNoor();
  const now = useNow(30_000);
  const [s, setS] = useState<TasbihState>(loadTasbih);
  const [pulse, setPulse] = useState(0);
  const [cheer, setCheer] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => saveTasbih(s), [s]);
  useEffect(() => setS((x) => rollDay(x)), [now]);

  const d = DHIKR.find((x) => x.id === s.id) ?? DHIKR[0];
  const target = targetOf(s, d);
  const count = s.counts[d.id] ?? 0;
  const progress = target ? Math.min(1, count / target) : (count % 100) / 100;

  const hint = useMemo(() => {
    if (!snapshot) return null;
    const times = snapshot.today.entries.filter((e) => e.prayer !== 'sunrise').map((e) => ({ name: PRAYER_NAMES[e.prayer], time: Date.parse(e.time) }));
    return suggestion(times, now);
  }, [snapshot, now]);

  const onTap = () => {
    const r = tap(s);
    setS(r.state);
    setPulse((p) => p + 1);
    if (r.done) {
      void playSound('noor_chime', 1);
      setCheer(r.next ? `MashaAllah! Now ${DHIKR.find((x) => x.id === r.next)?.en}` : 'MashaAllah! Round complete');
      window.setTimeout(() => setCheer(null), 2200);
    } else if (s.tapSound) {
      void playSound('noor_pop', 1);
    }
  };

  const choose = (id: string) => setS((x) => ({ ...x, id }));
  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      window.setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    setConfirmReset(false);
    setS((x) => ({ ...x, counts: { ...x.counts, [d.id]: 0 } }));
  };
  const startAfterSalah = () => setS((x) => ({ ...x, afterSalah: true, id: AFTER_SALAH[0], counts: { ...x.counts, ...Object.fromEntries(AFTER_SALAH.map((id) => [id, 0])) } }));

  // Ring geometry
  const size = 260;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <>
      {hint && !(s.afterSalah && hint.ids === AFTER_SALAH) && (
        <button className="n-tasbih__hint" onClick={() => (hint.ids === AFTER_SALAH ? startAfterSalah() : choose(hint.ids[0]))}>
          <NIcon name="sparkle" size={16} />
          <span>{hint.title}</span>
          <b>Start</b>
        </button>
      )}

      <div className="n-chipbar n-chipbar--dhikr">
        {DHIKR.map((x) => (
          <button key={x.id} className={`n-chipbar__item ${x.id === d.id ? 'is-on' : ''}`} onClick={() => choose(x.id)}>
            <span>{x.en}</span>
          </button>
        ))}
      </div>

      <section className="n-tasbih">
        <div className="n-tasbih__ar" lang="ar" dir="rtl">
          {d.ar}
        </div>
        <div className="n-tasbih__en">{d.en}</div>
        <div className="n-tasbih__meaning">
          {d.meaning}
          <span lang="bn">{d.bn}</span>
        </div>

        <button className="n-tasbih__bead" onClick={onTap} aria-label={`Count ${d.en}. ${count} so far`}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
            <circle cx={size / 2} cy={size / 2} r={r} className="n-tasbih__track" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              className="n-tasbih__prog"
              strokeWidth={stroke}
              strokeDasharray={c}
              strokeDashoffset={c * (1 - progress)}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </svg>
          <span className="n-tasbih__count" key={pulse}>
            {count}
          </span>
          <span className="n-tasbih__of">{target ? `of ${target}` : 'no limit'}</span>
          <span className="n-tasbih__tap">Tap anywhere in the circle</span>
        </button>

        {cheer && <div className="n-tasbih__cheer">{cheer}</div>}

        <div className="n-tasbih__when">
          <NIcon name="info" size={15} /> {d.when}
        </div>

        <div className="n-tasbih__actions">
          <button className="n-btn n-btn--ghost" onClick={reset}>
            <NIcon name="reset" size={18} /> {confirmReset ? 'Tap again to reset' : 'Reset'}
          </button>
        </div>
      </section>

      <div className="n-stats">
        <div>
          <strong>{s.today}</strong>
          <span>Today</span>
        </div>
        <div>
          <strong>{s.rounds}</strong>
          <span>Rounds</span>
        </div>
        <div>
          <strong>{s.streak}</strong>
          <span>Day streak</span>
        </div>
        <div>
          <strong>{s.total.toLocaleString()}</strong>
          <span>All time</span>
        </div>
      </div>

      <SectionTitle>Target for {d.en}</SectionTitle>
      <div className="n-choice n-choice--row">
        {TARGETS.map((t) => (
          <button key={t} className={target === t ? 'is-on' : ''} onClick={() => setS((x) => ({ ...x, targets: { ...x.targets, [d.id]: t } }))}>
            {t === 0 ? '∞' : t}
          </button>
        ))}
      </div>

      <div className="n-list">
        <div className="n-row">
          <span className="n-row__text">
            <span className="n-row__title">After-salah tasbih</span>
            <span className="n-row__detail">SubhanAllah 33 → Alhamdulillah 33 → Allahu Akbar 34, moving on by itself</span>
          </span>
          <Switch checked={s.afterSalah} onChange={(v) => (v ? startAfterSalah() : setS((x) => ({ ...x, afterSalah: false })))} />
        </div>
        <div className="n-row">
          <span className="n-row__text">
            <span className="n-row__title">Tap sound</span>
            <span className="n-row__detail">A soft click on each count (a chime always plays when a round is done)</span>
          </span>
          <Switch checked={s.tapSound} onChange={(v) => setS((x) => ({ ...x, tapSound: v }))} />
        </div>
      </div>
    </>
  );
}
