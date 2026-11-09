import { EID, SAHU, SPECIAL, type Block, type Guide } from '../namaz_more';
import { useState } from 'react';
import { toBn } from '../calendar';
import { useNoor } from '../context';
import { DUAS } from '../duas';
import { NIcon } from '../icons';
import {
  DUA_QUNUT,
  FARZ_INSIDE,
  FARZ_OUTSIDE,
  KALEMAS,
  KALEMA_NOTE,
  JANAZA_DUAS,
  JANAZA_FARZ,
  JANAZA_INTRO,
  JANAZA_MORE,
  JANAZA_NIYAT_MALE,
  JANAZA_NIYAT_NOTE,
  JANAZA_NOTES,
  JANAZA_SHART,
  JANAZA_STEPS,
  JANAZA_SUNNAH,
  NIYATS,
  NIYAT_NOTE,
  RAKATS,
  SALAH_NOTES,
  SALAH_STEPS,
  WUDU_BREAKS,
  WUDU_DUA,
  WUDU_FARZ,
  WUDU_STEPS,
  type Recite,
} from '../namaz';

type Part = 'steps' | 'niyat' | 'kalema' | 'janaza' | 'eid' | 'sahu' | 'special' | 'rakat' | 'wudu';

const PARTS: { id: Part; label: string }[] = [
  { id: 'steps', label: 'নামাজের নিয়ম' },
  { id: 'niyat', label: 'নিয়ত' },
  { id: 'kalema', label: 'কালেমা' },
  { id: 'janaza', label: 'জানাজা' },
  { id: 'eid', label: 'ঈদ' },
  { id: 'sahu', label: 'সাহু সিজদা' },
  { id: 'special', label: 'বিশেষ নামাজ' },
  { id: 'rakat', label: 'রাকাত' },
  { id: 'wudu', label: 'ওজু' },
];

/** নামাজ শিক্ষা — how to pray, niyat, kalema, rakat counts and wudu. */
export function NamazShikkha() {
  const [part, setPart] = useState<Part>('steps');
  const [say, setSay] = useState(true);

  return (
    <div className="n-namaz">
      <div className="n-chipbar n-chipbar--dua">
        {PARTS.map((p) => (
          <button key={p.id} className={`n-chipbar__item ${part === p.id ? 'is-on' : ''}`} onClick={() => setPart(p.id)} lang="bn">
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {(part === 'steps' || part === 'niyat' || part === 'kalema' || part === 'janaza' || part === 'eid' || part === 'sahu' || part === 'special' || part === 'wudu') && (
        <div className="n-namaz__tools">
          <button className={`n-chip ${say ? 'is-on' : ''}`} onClick={() => setSay((v) => !v)} lang="bn">
            উচ্চারণ {say ? 'লুকান' : 'দেখান'}
          </button>
        </div>
      )}

      {part === 'steps' && <Steps say={say} />}
      {part === 'niyat' && <Niyats say={say} />}
      {part === 'kalema' && <Kalemas say={say} />}
      {part === 'janaza' && <Janaza say={say} />}
      {part === 'eid' && <GuideView g={EID} say={say} />}
      {part === 'sahu' && <GuideView g={SAHU} say={say} />}
      {part === 'special' && <Special say={say} />}
      {part === 'rakat' && <Rakats />}
      {part === 'wudu' && <Wudu say={say} />}
    </div>
  );
}

function RecitePane({ r, say }: { r: Recite; say: boolean }) {
  return (
    <div className="n-namaz__recite">
      {r.times && r.times > 1 && <span className="n-dua__x">{toBn(r.times)} বার</span>}
      <p className="n-dua__ar" lang="ar" dir="rtl">
        {r.ar}
      </p>
      {say && (
        <p className="n-dua__say" lang="bn">
          <b>উচ্চারণ:</b> {r.say}
        </p>
      )}
      <p className="n-dua__mean" lang="bn">
        <b>অর্থ:</b> {r.mean}
      </p>
    </div>
  );
}

function Steps({ say }: { say: boolean }) {
  const { push } = useNoor();
  return (
    <>
      <p className="n-namaz__intro" lang="bn">
        দুই রাকাত নামাজ ধাপে ধাপে। তিন ও চার রাকাতের নিয়ম নিচে দেওয়া আছে।
      </p>
      <ol className="n-namaz__steps">
        {SALAH_STEPS.map((s, i) => (
          <li key={s.title} className="n-namaz__step">
            <header>
              <span className="n-namaz__num">{toBn(i + 1)}</span>
              <strong lang="bn">{s.title}</strong>
            </header>
            <p className="n-namaz__body" lang="bn">
              {s.body}
            </p>
            {s.recite?.map((r) => <RecitePane key={r.ar} r={r} say={say} />)}
            {s.duaIds?.map((id) => {
              const d = DUAS.find((x) => x.id === id);
              return d ? <RecitePane key={id} r={{ ar: d.ar, say: d.bnSay, mean: d.bnMeaning }} say={say} /> : null;
            })}
            {s.surahs && (
              <div className="n-namaz__surahs">
                {s.surahs.map((x) => (
                  <button key={x.n} className="n-chip" onClick={() => push({ kind: 'quran', surah: x.n })} lang="bn">
                    <NIcon name="book" size={14} /> {x.name}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      <section className="n-namaz__card">
        <h3 lang="bn">তিন ও চার রাকাত, বিতর</h3>
        <ul lang="bn">
          {SALAH_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <section className="n-namaz__card">
        <h3 lang="bn">দোয়া কুনুত (বিতরের তৃতীয় রাকাতে)</h3>
        <RecitePane r={DUA_QUNUT} say={say} />
      </section>

      <section className="n-namaz__card">
        <h3 lang="bn">নামাজের ১৩ ফরজ</h3>
        <div className="n-namaz__cols" lang="bn">
          <div>
            <b>বাইরে ৭টি (আহকাম)</b>
            <ol>
              {FARZ_OUTSIDE.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </div>
          <div>
            <b>ভিতরে ৬টি (আরকান)</b>
            <ol>
              {FARZ_INSIDE.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  );
}

function Niyats({ say }: { say: boolean }) {
  return (
    <>
      <p className="n-namaz__note" lang="bn">
        <NIcon name="info" size={14} /> {NIYAT_NOTE}
      </p>
      {NIYATS.map((n) => (
        <article key={n.id} className="n-dua">
          <header className="n-dua__head">
            <strong lang="bn">{n.title}</strong>
          </header>
          <RecitePane r={n} say={say} />
        </article>
      ))}
      <p className="n-namaz__note" lang="bn">
        অন্য সুন্নত বা নফলের নিয়তও একইভাবে — ওয়াক্তের নাম, রাকাত সংখ্যা এবং “সুন্নাতু রাসুলিল্লাহি তাআলা” বা নফলের জন্য “নাফলান” বলুন।
      </p>
    </>
  );
}

function Kalemas({ say }: { say: boolean }) {
  return (
    <>
      {KALEMAS.map((k, i) => (
        <article key={k.id} className="n-dua">
          <header className="n-dua__head">
            <span className="n-namaz__num">{toBn(i + 1)}</span>
            <strong lang="bn">{k.name}</strong>
            <small className="n-namaz__kname" lang="ar" dir="rtl">
              {k.nameAr}
            </small>
          </header>
          <RecitePane r={k} say={say} />
        </article>
      ))}
      <p className="n-namaz__note" lang="bn">
        <NIcon name="info" size={14} /> {KALEMA_NOTE}
      </p>
    </>
  );
}

function Janaza({ say }: { say: boolean }) {
  return (
    <>
      <p className="n-namaz__intro" lang="bn">
        {JANAZA_INTRO}
      </p>

      <section className="n-namaz__card">
        <h3 lang="bn">জানাজার ২ ফরজ</h3>
        <ol lang="bn">
          {JANAZA_FARZ.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      </section>

      <section className="n-namaz__card">
        <h3 lang="bn">শর্ত</h3>
        <ul lang="bn">
          {JANAZA_SHART.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      <section className="n-namaz__card">
        <h3 lang="bn">জানাজার নিয়ত</h3>
        <RecitePane r={JANAZA_NIYAT_MALE} say={say} />
        <p className="n-namaz__note" lang="bn">
          <NIcon name="info" size={14} /> {JANAZA_NIYAT_NOTE}
        </p>
      </section>

      <h3 className="n-namaz__h" lang="bn">
        নামাজ পড়ার নিয়ম — ধাপে ধাপে
      </h3>
      <ol className="n-namaz__steps">
        {JANAZA_STEPS.map((s, i) => (
          <li key={s.title} className="n-namaz__step">
            <header>
              <span className="n-namaz__num">{toBn(i + 1)}</span>
              <strong lang="bn">{s.title}</strong>
            </header>
            <p className="n-namaz__body" lang="bn">
              {s.body}
            </p>
            {s.recite?.map((r) => <RecitePane key={r.ar} r={r} say={say} />)}
          </li>
        ))}
      </ol>

      <h3 className="n-namaz__h" lang="bn">
        তৃতীয় তাকবিরের পর মৃতের জন্য দোয়া
      </h3>
      {JANAZA_DUAS.map((d) => (
        <article key={d.for} className="n-dua">
          <header className="n-dua__head">
            <strong lang="bn">{d.for}</strong>
          </header>
          <RecitePane r={d} say={say} />
          <p className="n-namaz__src" lang="bn">
            সূত্র: {d.source}
          </p>
        </article>
      ))}

      <section className="n-namaz__card">
        <h3 lang="bn">সুন্নত ও আদব</h3>
        <ul lang="bn">
          {JANAZA_SUNNAH.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      <section className="n-namaz__card">
        <h3 lang="bn">জরুরি মাসআলা</h3>
        <ul lang="bn">
          {JANAZA_NOTES.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      <h3 className="n-namaz__h" lang="bn">
        মৃত্যু, দাফন ও কবর জিয়ারতের দোয়া
      </h3>
      {JANAZA_MORE.map((m) => (
        <article key={m.title} className="n-dua">
          <header className="n-dua__head">
            <strong lang="bn">{m.title}</strong>
          </header>
          <p className="n-namaz__body" lang="bn">
            {m.when}
          </p>
          <RecitePane r={m.r} say={say} />
        </article>
      ))}
    </>
  );
}

function BlockView({ b, say }: { b: Block; say: boolean }) {
  switch (b.kind) {
    case 'intro':
      return (
        <p className="n-namaz__intro" lang="bn">
          {b.text}
        </p>
      );
    case 'note':
      return (
        <p className="n-namaz__note" lang="bn">
          <NIcon name="info" size={14} /> {b.text}
        </p>
      );
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return (
        <section className="n-namaz__card">
          <h3 lang="bn">{b.title}</h3>
          <L lang="bn">
            {b.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </L>
        </section>
      );
    }
    case 'recite':
      return (
        <article className="n-dua">
          <header className="n-dua__head">
            <strong lang="bn">{b.title}</strong>
          </header>
          <RecitePane r={b.r} say={say} />
          {b.note && (
            <p className="n-namaz__src" lang="bn">
              {b.note}
            </p>
          )}
          {b.source && (
            <p className="n-namaz__src" lang="bn">
              সূত্র: {b.source}
            </p>
          )}
        </article>
      );
    case 'steps':
      return (
        <>
          <h3 className="n-namaz__h" lang="bn">
            {b.title}
          </h3>
          <ol className="n-namaz__steps">
            {b.steps.map((st, i) => (
              <li key={st.title} className="n-namaz__step">
                <header>
                  <span className="n-namaz__num">{toBn(i + 1)}</span>
                  <strong lang="bn">{st.title}</strong>
                </header>
                <p className="n-namaz__body" lang="bn">
                  {st.body}
                </p>
                {st.recite?.map((r) => <RecitePane key={r.ar} r={r} say={say} />)}
              </li>
            ))}
          </ol>
        </>
      );
  }
}

function GuideView({ g, say }: { g: Guide; say: boolean }) {
  return (
    <>
      {g.blocks.map((b, i) => (
        <BlockView key={i} b={b} say={say} />
      ))}
    </>
  );
}

function Special({ say }: { say: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="n-namaz__special">
      {SPECIAL.map((g) => (
        <section key={g.id} className={`n-namaz__acc${open === g.id ? ' is-open' : ''}`}>
          <button className="n-namaz__acchead" onClick={() => setOpen((o) => (o === g.id ? null : g.id))} aria-expanded={open === g.id}>
            <span>
              <strong lang="bn">{g.title}</strong>
              <small lang="bn">{g.sub}</small>
            </span>
            <NIcon name="chevronRight" size={18} />
          </button>
          {open === g.id && (
            <div className="n-namaz__accbody">
              <GuideView g={g} say={say} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Rakats() {
  return (
    <>
      <div className="n-rakat">
        {RAKATS.map((r) => {
          const must = r.parts.filter((p) => !p.optional).reduce((s, p) => s + p.n, 0);
          return (
            <div key={r.en} className="n-rakat__row">
              <div className="n-rakat__name">
                <strong lang="bn">{r.name}</strong>
                <small>{r.en}</small>
              </div>
              <div className="n-rakat__parts">
                {r.parts.map((p, i) => (
                  <span key={i} className={`n-rakat__part is-${p.label === 'ফরজ' ? 'fard' : p.label === 'বিতর' ? 'witr' : p.optional ? 'opt' : 'sunnah'}`} lang="bn">
                    <b>{toBn(p.n)}</b>
                    {p.label}
                  </span>
                ))}
              </div>
              <div className="n-rakat__sum" lang="bn">
                {toBn(must)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="n-rakat__legend" lang="bn">
        <span className="is-fard">ফরজ</span>
        <span className="is-witr">বিতর — ওয়াজিব</span>
        <span className="is-sunnah">সুন্নতে মুয়াক্কাদা</span>
        <span className="is-opt">গায়রে মুয়াক্কাদা / নফল</span>
      </div>
      <p className="n-namaz__note" lang="bn">
        ডান পাশের সংখ্যা: ফরজ, ওয়াজিব ও সুন্নতে মুয়াক্কাদা মিলিয়ে মোট রাকাত। হাল্কা রঙের নামাজগুলো পড়লে সওয়াব, না পড়লে গুনাহ নেই। (হানাফি মাজহাব অনুযায়ী)
      </p>
    </>
  );
}

function Wudu({ say }: { say: boolean }) {
  return (
    <>
      <section className="n-namaz__card">
        <h3 lang="bn">ওজুর ৪ ফরজ</h3>
        <ol lang="bn">
          {WUDU_FARZ.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      </section>
      <ol className="n-namaz__steps">
        {WUDU_STEPS.map((s, i) => (
          <li key={s} className="n-namaz__step">
            <header>
              <span className="n-namaz__num">{toBn(i + 1)}</span>
              <p className="n-namaz__body" lang="bn">
                {s}
              </p>
            </header>
          </li>
        ))}
      </ol>
      <section className="n-namaz__card">
        <h3 lang="bn">ওজুর পরের দোয়া</h3>
        <RecitePane r={WUDU_DUA} say={say} />
      </section>
      <section className="n-namaz__card">
        <h3 lang="bn">যেসব কারণে ওজু ভেঙে যায়</h3>
        <ul lang="bn">
          {WUDU_BREAKS.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
