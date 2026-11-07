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

type Part = 'steps' | 'niyat' | 'kalema' | 'rakat' | 'wudu';

const PARTS: { id: Part; label: string }[] = [
  { id: 'steps', label: 'নামাজের নিয়ম' },
  { id: 'niyat', label: 'নিয়ত' },
  { id: 'kalema', label: 'কালেমা' },
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

      {(part === 'steps' || part === 'niyat' || part === 'kalema' || part === 'wudu') && (
        <div className="n-namaz__tools">
          <button className={`n-chip ${say ? 'is-on' : ''}`} onClick={() => setSay((v) => !v)} lang="bn">
            উচ্চারণ {say ? 'লুকান' : 'দেখান'}
          </button>
        </div>
      )}

      {part === 'steps' && <Steps say={say} />}
      {part === 'niyat' && <Niyats say={say} />}
      {part === 'kalema' && <Kalemas say={say} />}
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
