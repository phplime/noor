import { useEffect, useMemo, useState } from 'react';
import { errorText } from '../../../island/lib/ipc';
import { useNow } from '../../../island/lib/hooks';
import { noor, toLocalInput } from '../../api';
import { toBn } from '../../calendar';
import { useNoor } from '../../context';
import { DUAS_EN } from '../../duas_en';
import { isEn, useLang } from '../../lang';
import { AMAL, TIME_LABEL, amalForToday, countKey, duasFor, loadProgress, saveProgress, suggestedTime, type Dua, type DuaProgress, type DuaTime } from '../../duas';
import { NIcon } from '../../icons';


type Tab = DuaTime | 'amal';

const HEADING: Record<DuaTime, string> = { morning: 'সকালের দোয়া', evening: 'সন্ধ্যার দোয়া', sleep: 'ঘুমের আগের দোয়া', salah: 'নামাজের দোয়া', surah: 'শেষ দশ সূরা' };

const TABS: { id: Tab; label: string }[] = [
  { id: 'morning', label: 'সকাল' },
  { id: 'evening', label: 'সন্ধ্যা' },
  { id: 'sleep', label: 'ঘুম' },
  { id: 'salah', label: 'দরুদ ও আত্তাহিয়্যাতু' },
  { id: 'surah', label: 'শেষ ১০ সূরা' },
  { id: 'amal', label: 'আমল' },
];

const REMIND: Partial<Record<DuaTime, { h: number; m: number; title: string }>> = {
  morning: { h: 6, m: 30, title: 'সকালের যিকির · Morning adhkar' },
  evening: { h: 17, m: 0, title: 'সন্ধ্যার যিকির · Evening adhkar' },
  sleep: { h: 22, m: 0, title: 'ঘুমের আগের দোয়া · Before sleep' },
};

export function DuasView() {
  const { snapshot, flash, permission, askPermission } = useNoor();
  const now = useNow(60_000);
  const en = isEn(useLang());
  const [p, setP] = useState<DuaProgress>(loadProgress);
  const auto = useMemo<DuaTime>(() => {
    const list = snapshot?.today.entries.map((e) => ({ prayer: e.prayer, time: Date.parse(e.time) })) ?? [];
    return suggestedTime(list, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);
  const [tab, setTab] = useState<Tab>(auto);
  const [showSay, setShowSay] = useState(true);

  useEffect(() => saveProgress(p), [p]);

  const list = tab === 'amal' ? [] : duasFor(tab);
  const done = (time: DuaTime, d: Dua) => (p.counts[countKey(time, d.id)] ?? 0) >= d.count;
  const doneCount = tab === 'amal' ? 0 : list.filter((d) => done(tab, d)).length;

  const bump = (time: DuaTime, d: Dua) =>
    setP((x) => {
      const k = countKey(time, d.id);
      const n = Math.min(d.count, (x.counts[k] ?? 0) + 1);
      return { ...x, counts: { ...x.counts, [k]: n } };
    });
  const undo = (time: DuaTime, d: Dua) => setP((x) => ({ ...x, counts: { ...x.counts, [countKey(time, d.id)]: 0 } }));

  const todays = amalForToday();
  const amalDone = todays.filter((a) => p.amal[a.id]).length;
  const toggleAmal = (id: string) =>
    setP((x) => {
      const amal = { ...x.amal, [id]: !x.amal[id] };
      const full = todays.every((a) => amal[a.id]);
      const streak = full && x.lastFull !== x.day ? x.streak + 1 : x.streak;
      return { ...x, amal, streak, lastFull: full ? x.day : x.lastFull };
    });

  const remind = async (time: DuaTime) => {
    try {
      if (permission !== 'granted') await askPermission();
      const r = REMIND[time];
      if (!r) return;
      const d = new Date();
      d.setHours(r.h, r.m, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      await noor.reminderSave({ title: r.title, note: 'Noor › Prayer › Dua', at: toLocalInput(d), repeat: 'daily', enabled: true, sound: 'noor_soft', color: '#3fa985' });
      flash(`Daily reminder at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — change it in Reminders`);
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <>
      <div className="n-chipbar n-chipbar--dua">
        {TABS.map((x) => (
          <button key={x.id} className={`n-chipbar__item ${tab === x.id ? 'is-on' : ''}`} onClick={() => setTab(x.id)} lang="bn">
            <span>{x.label}</span>
          </button>
        ))}
      </div>

      {tab !== 'amal' ? (
        <>
          <div className="n-dua__bar">
            <div>
              <strong>
                {HEADING[tab]} · {TIME_LABEL[tab].en}
              </strong>
              <span>
                {toBn(doneCount)}/{toBn(list.length)} সম্পন্ন
              </span>
            </div>
            <div className="n-dua__meter">
              <i style={{ width: `${(doneCount / Math.max(1, list.length)) * 100}%` }} />
            </div>
            <div className="n-dua__tools">
              <button className={`n-chip ${showSay ? 'is-on' : ''}`} onClick={() => setShowSay((v) => !v)}>
                {en ? `${showSay ? 'Hide' : 'Show'} pronunciation` : `উচ্চারণ ${showSay ? 'লুকান' : 'দেখান'}`}
              </button>
              {REMIND[tab] && (
                <button className="n-chip" onClick={() => void remind(tab)}>
                  <NIcon name="bell" size={14} /> রিমাইন্ডার
                </button>
              )}
            </div>
          </div>

          {list.map((d) => {
            const n = p.counts[countKey(tab, d.id)] ?? 0;
            const ok = n >= d.count;
            const E = en ? DUAS_EN[d.id] : undefined;
            const L = E ? 'en' : 'bn';
            const num = (x: number) => (E ? String(x) : toBn(x));
            return (
              <article key={d.id} className={`n-dua ${ok ? 'is-done' : ''}`}>
                <header className="n-dua__head">
                  <strong lang={L}>{E?.title ?? d.title}</strong>
                  {tab !== 'surah' && <span className="n-dua__x">{E ? `${d.count}×` : d.count > 1 ? `${toBn(d.count)} বার` : '১ বার'}</span>}
                </header>
                <p className="n-dua__ar" lang="ar" dir="rtl">
                  {d.ar}
                </p>
                {showSay && (E ? E.say : d.bnSay) && (
                  <p className="n-dua__say" lang={L}>
                    <b>{E ? 'Say:' : 'উচ্চারণ:'}</b> {E ? E.say : d.bnSay}
                  </p>
                )}
                <p className="n-dua__mean" lang={L}>
                  <b>{E ? 'Meaning:' : 'অর্থ:'}</b> {E ? E.meaning : d.bnMeaning}
                </p>
                <p className="n-dua__note" lang={L}>
                  <NIcon name="sparkle" size={13} /> {E ? E.note : d.note}
                </p>
                <footer className="n-dua__foot">
                  <small>{E ? E.source : d.source}</small>
                  {ok ? (
                    <button className="n-dua__btn is-done" onClick={() => undo(tab, d)}>
                      <NIcon name="check" size={16} stroke={2.6} /> {E ? 'Done' : 'পড়েছি'}
                    </button>
                  ) : (
                    <button className="n-dua__btn" onClick={() => bump(tab, d)}>
                      {d.count > 1 ? `${num(n)}/${num(d.count)} · ${E ? 'Read +1' : 'পড়লাম +১'}` : E ? 'Mark read' : 'পড়েছি'}
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
          <p className="n-hint">দোয়াগুলো হিসনুল মুসলিম ও উল্লেখিত হাদিস গ্রন্থ থেকে। বাংলা উচ্চারণ কাছাকাছি — সঠিক উচ্চারণের জন্য আরবি দেখে পড়ুন বা আলেমের কাছে শিখে নিন।</p>
        </>
      ) : (
        <>
          <div className="n-dua__bar">
            <div>
              <strong>আজকের আমল · Today’s good deeds</strong>
              <span>
                {toBn(amalDone)}/{toBn(todays.length)} সম্পন্ন{p.streak ? ` · ${toBn(p.streak)} দিন পূর্ণ` : ''}
              </span>
            </div>
            <div className="n-dua__meter">
              <i style={{ width: `${(amalDone / Math.max(1, todays.length)) * 100}%` }} />
            </div>
          </div>
          <div className="n-list">
            {todays.map((a) => (
              <button key={a.id} className={`n-amal ${p.amal[a.id] ? 'is-done' : ''}`} onClick={() => toggleAmal(a.id)}>
                <span className="n-amal__box">{p.amal[a.id] && <NIcon name="check" size={15} stroke={3} />}</span>
                <span className="n-amal__text" lang="bn">
                  <b>{a.title}</b>
                  <small>{a.detail}</small>
                </span>
              </button>
            ))}
          </div>
          <p className="n-hint">প্রতিদিন নতুন করে শুরু হয়। {AMAL.length - todays.length > 0 ? 'কিছু আমল নির্দিষ্ট দিনে দেখা যায় (সোম/বৃহস্পতি, শুক্রবার)।' : ''}</p>
        </>
      )}
    </>
  );
}
