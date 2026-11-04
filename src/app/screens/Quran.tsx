import { useEffect, useMemo, useRef, useState } from 'react';
import { useNoor } from '../context';
import { NIcon } from '../icons';
import { BISMILLAH, arNum, bnNum, quran, readState, saveState, toggleBookmark, type QuranState, type Surah, type SurahInfo } from '../quran';
import { Page, SectionTitle, Segmented, Sheet, Switch } from '../ui';
import { RECITERS, reciter, useRecitation } from '../recite';

const FAVOURITES = [18, 36, 55, 56, 67, 1];

function useIndex() {
  const [list, setList] = useState<SurahInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    quran.index().then(setList, (e: Error) => setError(e.message));
  }, []);
  return { list, error };
}

/** Surah list, continue-reading and bookmarks. Opening a surah pushes the reader. */
export function QuranHome() {
  const { push } = useNoor();
  const { list, error } = useIndex();
  const [q, setQ] = useState('');
  const [st, setSt] = useState<QuranState>(readState);
  useEffect(() => {
    const on = () => setSt(readState());
    window.addEventListener('noor:quran', on);
    window.addEventListener('focus', on);
    return () => {
      window.removeEventListener('noor:quran', on);
      window.removeEventListener('focus', on);
    };
  }, []);
  const byN = useMemo(() => new Map(list?.map((s) => [s.n, s])), [list]);
  const open = (s: number, a?: number) => push({ kind: 'quran', surah: s, ayah: a });
  const needle = q.trim().toLowerCase();
  const shown = (list ?? []).filter(
    (s) => !needle || String(s.n) === needle || s.en.toLowerCase().includes(needle) || s.bn.includes(q.trim()) || s.ar.includes(q.trim()),
  );

  if (error) return <p className="n-hint">{error}</p>;
  return (
    <div className="n-quran">
      {st.last && byN.get(st.last.s) && (
        <button className="n-qcontinue" onClick={() => open(st.last!.s, st.last!.a)}>
          <span className="n-qcontinue__icon">
            <NIcon name="book" size={22} />
          </span>
          <span>
            <small>Continue reading</small>
            <b>
              {byN.get(st.last.s)!.en} · {st.last.s}:{st.last.a}
            </b>
          </span>
          <em lang="ar">{byN.get(st.last.s)!.ar}</em>
        </button>
      )}

      <div className="n-qfav">
        {FAVOURITES.map((n) => {
          const s = byN.get(n);
          return s ? (
            <button key={n} className="n-chip" onClick={() => open(n)}>
              {s.en}
            </button>
          ) : null;
        })}
      </div>

      {st.bookmarks.length > 0 && (
        <>
          <SectionTitle>Bookmarks</SectionTitle>
          <div className="n-list n-qbm">
            {st.bookmarks.slice(0, 8).map((b) => (
              <button key={`${b.s}:${b.a}`} className="n-qrow" onClick={() => open(b.s, b.a)}>
                <NIcon name="bookmark" size={18} />
                <span>
                  <b>{byN.get(b.s)?.en}</b>
                  <small>Ayah {b.a}</small>
                </span>
                <em lang="ar">{byN.get(b.s)?.ar}</em>
              </button>
            ))}
          </div>
        </>
      )}

      <input className="n-input n-qsearch" placeholder="Search surah — name, meaning or number" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="n-list">
        {!list && <p className="n-hint">Loading…</p>}
        {shown.map((s) => (
          <button key={s.n} className="n-qrow" onClick={() => open(s.n)}>
            <span className="n-qnum">{s.n}</span>
            <span>
              <b>{s.en}</b>
              <small>
                <span lang="bn">{s.bn}</span> · {s.ayahs} ayahs · {s.type === 'meccan' ? 'Makki' : 'Madani'}
              </small>
            </span>
            <em lang="ar">{s.ar}</em>
          </button>
        ))}
      </div>
      <p className="n-hint n-qcredit">
        Arabic: Uthmani text, The Noble Qur’an Encyclopedia. Bangla: Muhiuddin Khan (tanzil.net). Compiled by quran-json, CC-BY-SA 4.0. Font: Amiri Quran (OFL).
      </p>
    </div>
  );
}

/** Pushed page: the reader for one surah, or the list. */
export function QuranPage({ surah, ayah, onBack }: { surah?: number; ayah?: number; onBack: () => void }) {
  if (!surah) {
    return (
      <Page title="Qur’an" onBack={onBack}>
        <div className="n-pad-x">
          <QuranHome />
        </div>
      </Page>
    );
  }
  return <SurahReader key={surah} n={surah} target={ayah} onBack={onBack} />;
}

function SurahReader({ n, target, onBack }: { n: number; target?: number; onBack: () => void }) {
  const { push, flash } = useNoor();
  const { list } = useIndex();
  const info = list?.find((s) => s.n === n);
  const [data, setData] = useState<Surah | null>(null);
  const [st, setSt] = useState<QuranState>(readState);
  const [prefs, setPrefs] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    quran.surah(n).then(setData, (e: Error) => flash(e.message));
  }, [n, flash]);

  // Jump to the requested ayah (or where you left off in this surah).
  useEffect(() => {
    if (!data) return;
    const goto = target ?? (st.last?.s === n ? st.last.a : undefined);
    if (goto && goto > 1) {
      requestAnimationFrame(() => document.getElementById(`ayah-${goto}`)?.scrollIntoView({ block: 'start' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Remember the topmost ayah on screen.
  useEffect(() => {
    if (!data || !body.current) return;
    let t: number | undefined;
    const seen = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const a = Number((e.target as HTMLElement).dataset.ayah);
          if (e.isIntersecting) seen.add(a);
          else seen.delete(a);
        }
        if (!seen.size) return;
        const top = Math.min(...seen);
        window.clearTimeout(t);
        t = window.setTimeout(() => {
          saveState({ last: { s: n, a: top, at: Date.now() } });
          window.dispatchEvent(new Event('noor:quran'));
        }, 600);
      },
      { rootMargin: '-15% 0px -60% 0px' },
    );
    body.current.querySelectorAll('[data-ayah]').forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  }, [data, n]);

  const rs = useRecitation();
  const live = rs.phase !== 'idle' && rs.surah === n;
  const total = info?.ayahs ?? data?.v.length ?? 0;
  const title = info?.en ?? `Surah ${n}`;
  const playFrom = (a: number) => reciter.play(n, a, total, title);

  // Follow the recitation: keep the ayah being read in view.
  useEffect(() => {
    if (!live) return;
    const el = rs.ayah === 0 ? document.getElementById('ayah-bismillah') : document.getElementById(`ayah-${rs.ayah}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [live, rs.ayah]);

  // Leaving the surah stops the recitation.
  useEffect(() => () => reciter.stop(), []);

  useEffect(() => {
    if (rs.error) flash(rs.error);
  }, [rs.error, flash]);

  const marked = (a: number) => st.bookmarks.some((b) => b.s === n && b.a === a);
  const setFont = (d: number) => setSt(saveState({ fontSize: Math.min(46, Math.max(20, st.fontSize + d)) }));

  return (
    <Page
      title={info ? info.en : `Surah ${n}`}
      onBack={onBack}
      right={
        <button className="n-iconbtn" onClick={() => setPrefs(true)} aria-label="Reading settings">
          <NIcon name="sliders" size={19} />
        </button>
      }
    >
      <div
        className={`n-pad-x n-reader q-font-${st.font} ${st.bold ? 'q-bold' : ''} ${st.wide ? 'q-wide' : ''}`}
        ref={body}
        style={{ ['--qfs' as string]: `${st.fontSize}px` }}
      >
        {info && (
          <header className="n-qhero">
            <span lang="ar" className="n-qhero__ar">
              سورة {info.ar}
            </span>
            <b>{info.en}</b>
            <small>
              <span lang="bn">{info.bn}</span> · {info.ayahs} ayahs · {info.type === 'meccan' ? 'Makki · মাক্কী' : 'Madani · মাদানী'}
            </small>
          </header>
        )}
        {n !== 1 && n !== 9 && (
          <p id="ayah-bismillah" className={`n-qbismillah ${live && rs.ayah === 0 ? 'is-playing' : ''}`} lang="ar" dir="rtl">
            {BISMILLAH}
          </p>
        )}
        {!data && <p className="n-hint">Loading…</p>}
        {data?.v.map(([ar, bn, tr], i) => {
          const a = i + 1;
          return (
            <article key={a} id={`ayah-${a}`} data-ayah={a} className={`n-ayah ${target === a ? 'is-target' : ''} ${live && rs.ayah === a ? 'is-playing' : ''}`}>
              <div className="n-ayah__bar">
                <span className="n-ayah__num">
                  {n}:{a}
                </span>
                <button
                  className="n-iconbtn n-ayah__play"
                  aria-label={live && rs.ayah === a && rs.phase === 'playing' ? 'Pause' : `Recite from ayah ${a}`}
                  onClick={() => (live && rs.ayah === a ? reciter.toggle() : live ? reciter.goto(a) : playFrom(a))}
                >
                  <NIcon name={live && rs.ayah === a && rs.phase === 'playing' ? 'pause' : 'play'} size={15} stroke={2.2} />
                </button>
                <button
                  className={`n-iconbtn n-ayah__bm ${marked(a) ? 'is-on' : ''}`}
                  aria-label={marked(a) ? 'Remove bookmark' : 'Bookmark'}
                  onClick={() => {
                    const next = toggleBookmark(n, a);
                    setSt(next);
                    flash(next.bookmarks.some((b) => b.s === n && b.a === a) ? `Bookmarked ${n}:${a}` : 'Bookmark removed');
                  }}
                >
                  <NIcon name="bookmark" size={17} />
                </button>
              </div>
              <p className="n-ayah__ar" lang="ar" dir="rtl">
                {ar} <span className="n-ayah__end">{'۝'}{arNum(a)}</span>
              </p>
              {st.showTr && tr && (
                <p className="n-ayah__tr" lang="bn">
                  <small>উচ্চারণ</small>
                  {tr}
                </p>
              )}
              {st.showBn && (
                <p className="n-ayah__bn" lang="bn">
                  <small>অর্থ</small>
                  <span>{bnNum(a)}.</span> {bn}
                </p>
              )}
            </article>
          );
        })}
        <div className="n-qplayer-space" />
        {data && (
          <nav className="n-qnav">
            {n > 1 && (
              <button className="n-btn n-btn--ghost" onClick={() => push({ kind: 'quran', surah: n - 1 })}>
                <NIcon name="chevronLeft" size={18} /> Previous surah
              </button>
            )}
            {n < 114 && (
              <button className="n-btn" onClick={() => push({ kind: 'quran', surah: n + 1 })}>
                Next surah <NIcon name="chevronRight" size={18} />
              </button>
            )}
          </nav>
        )}
      </div>

      {data &&
        (live ? (
          <div className={`n-qplayer ${rs.phase === 'loading' ? 'is-loading' : ''}`}>
            <div className="n-qplayer__info">
              <b>{rs.ayah === 0 ? 'Bismillah' : `Ayah ${rs.ayah} of ${total}`}</b>
              <small>{RECITERS.find((r) => r.id === rs.reciter)?.en}</small>
              <span className="n-qplayer__bar">
                <i style={{ width: `${(Math.max(0, rs.ayah) / Math.max(1, total)) * 100}%` }} />
              </span>
            </div>
            <button className={`n-iconbtn n-qplayer__rep ${rs.repeat ? 'is-on' : ''}`} onClick={() => reciter.setRepeat(!rs.repeat)} aria-label="Repeat this ayah">
              <NIcon name="repeat" size={17} />
            </button>
            <button className="n-iconbtn" onClick={() => reciter.step(-1)} aria-label="Previous ayah">
              <NIcon name="skipBack" size={18} />
            </button>
            <button className="n-qplayer__main" onClick={() => reciter.toggle()} aria-label={rs.phase === 'paused' ? 'Play' : 'Pause'}>
              {rs.phase === 'loading' ? <span className="n-qplayer__spin" /> : <NIcon name={rs.phase === 'paused' ? 'play' : 'pause'} size={22} stroke={2.4} />}
            </button>
            <button className="n-iconbtn" onClick={() => reciter.step(1)} aria-label="Next ayah">
              <NIcon name="skipFwd" size={18} />
            </button>
            <button className="n-iconbtn" onClick={() => reciter.stop()} aria-label="Stop">
              <NIcon name="x" size={17} />
            </button>
          </div>
        ) : (
          <button className="n-qlisten" onClick={() => playFrom(st.last?.s === n ? st.last.a : 1)}>
            <NIcon name="headphones" size={18} /> Listen · <span lang="bn">তিলাওয়াত শুনুন</span>
          </button>
        ))}

      <Sheet open={prefs} onClose={() => setPrefs(false)} title="Reading" closeLabel="Done">
        <div className={`n-form q-font-${st.font} ${st.bold ? 'q-bold' : ''} ${st.wide ? 'q-wide' : ''}`}>
          <div className="n-qfontpick">
            <Segmented
              value={st.font}
              onChange={(f) => setSt(saveState({ font: f }))}
              options={[
                { id: 'clear', label: 'Clear (easy)' },
                { id: 'classic', label: 'Classic' },
              ]}
            />
          </div>
          <div className="n-field n-field--row">
            <span>Bold letters</span>
            <Switch checked={st.bold} onChange={(v) => setSt(saveState({ bold: v }))} />
          </div>
          <div className="n-field n-field--row">
            <span>Wide word spacing</span>
            <Switch checked={st.wide} onChange={(v) => setSt(saveState({ wide: v }))} />
          </div>
          <div className="n-field n-field--row">
            <span>Arabic text size</span>
            <span className="n-stepper">
              <button type="button" onClick={() => setFont(-2)} aria-label="Smaller">
                A−
              </button>
              <span className="n-stepper__v">{st.fontSize}</span>
              <button type="button" onClick={() => setFont(2)}>
                A+
              </button>
            </span>
          </div>
          <div className="n-field">
            <span>Reciter · ক্বারী</span>
            <div className="n-qreciters">
              {RECITERS.map((r) => (
                <button key={r.id} className={`n-chip ${rs.reciter === r.id ? 'is-on' : ''}`} onClick={() => reciter.setReciter(r.id)}>
                  {r.en}
                </button>
              ))}
            </div>
          </div>
          <div className="n-field n-field--row">
            <span>Pronunciation · উচ্চারণ</span>
            <Switch checked={st.showTr} onChange={(v) => setSt(saveState({ showTr: v }))} />
          </div>
          <div className="n-field n-field--row">
            <span>Bangla meaning · বাংলা অর্থ</span>
            <Switch checked={st.showBn} onChange={(v) => setSt(saveState({ showBn: v }))} />
          </div>
          <p className="n-qbismillah n-qpreview" lang="ar" dir="rtl" style={{ fontSize: st.fontSize }}>
            وَٱلۡقُرۡءَانِ ٱلۡحَكِيمِ
          </p>
          <p className="n-hint n-hint--flush">
            উচ্চারণ is generated from the Arabic letters and vowel marks to help you read along. Bangla letters can't show every Arabic sound — for correct recitation, follow the Arabic and learn tajweed from a teacher.
          </p>
        </div>
      </Sheet>
    </Page>
  );
}
