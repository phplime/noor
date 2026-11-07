import { useEffect, useState } from 'react';
import { NIcon } from '../../icons';
import { isEn, useLang } from '../../lang';
import { ayahOfDay, quran, type DailyAyah, type SurahInfo } from '../../quran';

/** A verse a day, with Bangla meaning. */
export function AyahCard({ date, onOpen }: { date: string; onOpen: (s: number, a: number) => void }) {
  const [ayah, setAyah] = useState<DailyAyah | null>(null);
  const [names, setNames] = useState<SurahInfo[]>([]);
  const en = isEn(useLang());
  useEffect(() => {
    quran.daily().then((l) => setAyah(ayahOfDay(l, date)), () => undefined);
    quran.index().then(setNames, () => undefined);
  }, [date]);
  if (!ayah) return null;
  const s = names.find((x) => x.n === ayah.s);
  return (
    <section className="n-ayahcard" onClick={() => onOpen(ayah.s, ayah.a)} role="button" tabIndex={0}>
      <header>
        <span>
          <NIcon name="book" size={15} /> Ayah of the day
        </span>
        <small>
          {s?.en ?? `Surah ${ayah.s}`} · {ayah.s}:{ayah.a}
        </small>
      </header>
      <p className="n-ayahcard__ar" lang="ar" dir="rtl">
        {ayah.ar}
      </p>
      {(en ? ayah.trEn : ayah.tr) && (
        <p className="n-ayahcard__tr" lang={en ? 'en' : 'bn'}>
          {en ? ayah.trEn : ayah.tr}
        </p>
      )}
      <p className="n-ayahcard__bn" lang={en ? 'en' : 'bn'}>
        {en ? ayah.en ?? ayah.bn : ayah.bn}
      </p>
    </section>
  );
}
