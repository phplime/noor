import { useEffect, useState } from 'react';
import { NIcon } from '../../icons';

const ITEMS = [
  { id: 'ghusl', en: 'Ghusl & clean clothes', bn: 'গোসল ও পরিষ্কার কাপড়' },
  { id: 'kahf', en: 'Read Surah Al-Kahf', bn: 'সূরা কাহফ পড়া' },
  { id: 'early', en: "Go early to Jumu'ah", bn: 'আগে আগে মসজিদে যাওয়া' },
  { id: 'durud', en: 'Durud on the Prophet ﷺ', bn: 'বেশি বেশি দরুদ পড়া' },
  { id: 'dua', en: "Du'a before Maghrib", bn: 'মাগরিবের আগে দোয়া' },
] as const;

const key = (date: string) => `noor.friday.${date}`;

function load(date: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(date)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Friday sunnah checklist; ticks are kept per Friday. */
export function FridayCard({ date, onKahf }: { date: string; onKahf: () => void }) {
  const [done, setDone] = useState<string[]>(() => load(date));
  useEffect(() => setDone(load(date)), [date]);
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    try {
      localStorage.setItem(key(date), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return (
    <section className="n-friday">
      <header>
        <span className="n-friday__badge">
          <NIcon name="mosque" size={18} />
        </span>
        <div>
          <strong>Jumu'ah Mubarak</strong>
          <small lang="bn">জুমার সুন্নাতসমূহ · {done.length}/{ITEMS.length}</small>
        </div>
      </header>
      <ul>
        {ITEMS.map((it) => {
          const on = done.includes(it.id);
          return (
            <li key={it.id} className={on ? 'is-done' : ''}>
              <button className="n-friday__check" onClick={() => toggle(it.id)} aria-pressed={on}>
                <span>{on && <NIcon name="check" size={13} stroke={3} />}</span>
                <b>{it.en}</b>
                <small lang="bn">{it.bn}</small>
              </button>
              {it.id === 'kahf' && (
                <button className="n-chip n-friday__read" onClick={onKahf}>
                  <NIcon name="book" size={14} /> Read
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
