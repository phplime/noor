import { useEffect, useState } from 'react';
import { useNow } from '../../island/lib/hooks';
import { findNext, formatTime } from '../../island/lib/time';
import { PRAYER_NAMES } from '../../island/lib/types';
import { formatMs, useWidgetData, w } from '../../island/lib/widgets';
import { inLabel, noor, nextOccurrence, type PlannedNotification } from '../api';
import { cal } from '../calendar';
import { useNoor } from '../context';
import { splitTime } from '../format';
import { useHomeLayout, useLoad, useToday, type HomeCardId } from '../hooks';
import { NIcon, type NoorIconName } from '../icons';
import { greeting } from '../islamic';
import { Card, List, SectionTitle } from '../ui';
import { DateCard } from './home/DateCard';
import { HomeEditor } from './home/HomeEditor';
import { OccasionsCard } from './home/OccasionsCard';
import { PhotosCard } from './home/PhotosCard';
import { Avatar, ProfileSheet } from './home/ProfileSheet';
import { RamadanCard } from './home/RamadanCard';
import { PrayerArc } from './home/PrayerArc';
import { FridayCard } from './home/FridayCard';
import { AyahCard } from './home/AyahCard';
import { ShortcutsCard } from './home/ShortcutsCard';
import { useWeather } from '../weather';
import { SalahDot, SalahMarkSheet } from './SalahTracker';
import { useSalah, type SalahPrayer, type SalahStatus } from '../salah';

const KIND_ICON: Record<string, NoorIconName> = {
  prayer: 'moon',
  ramadan: 'sunrise',
  special: 'gift',
  water: 'drop',
  timer: 'timer',
  reminder: 'bell',
  refresh: 'sparkle',
  test: 'bell',
};

export function HomeScreen() {
  const { snapshot, go, push, permission, askPermission, prayerError } = useNoor();
  const today = useToday();
  const [layout, setLayout] = useHomeLayout();
  const [editing, setEditing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const weather = useWeather(snapshot?.activeLocation.latitude, snapshot?.activeLocation.longitude);
  const salahDate = snapshot?.today.date ?? today;
  const salahToday = useSalah(salahDate, salahDate);
  const [marking, setMarking] = useState<{ date: string; prayer: SalahPrayer; status: SalahStatus | null } | null>(null);

  const { data: profile } = useLoad(() => cal.profile(), [], ['profile']);
  const { data: day } = useLoad(() => cal.day(today), [today], ['calendar']);
  const { data: occasions } = useLoad(() => cal.upcoming(today, 60), [today], ['calendar']);
  const { data: ramadan } = useLoad(() => cal.ramadan(), [today], ['ramadan', 'calendar', 'settings']);

  const { data: water } = useWidgetData('water', w.water);
  const { data: settings } = useWidgetData('settings', w.settings);
  const { data: timer } = useWidgetData('timer', w.timer);
  const { data: todos } = useWidgetData('todo', w.todos);
  // Battery: Home only needs a 1 s tick while a timer counts down on it (the prayer card ticks by itself).
  const now = useNow(timer?.endsAt ? 1000 : 20_000);
  const { data: reminders } = useWidgetData('reminders', noor.reminders);
  const [upcoming, setUpcoming] = useState<PlannedNotification[]>([]);

  useEffect(() => {
    void noor.upcoming(4).then(setUpcoming).catch(() => undefined);
  }, [snapshot, reminders, timer, water, settings, ramadan, occasions]);

  const tz = snapshot?.activeLocation.timezone ?? 'UTC';
  const use24 = snapshot?.settings.display.use24Hour ?? false;
  const days = snapshot ? [snapshot.today, snapshot.tomorrow] : [];
  const next = snapshot ? findNext(days, now) : null;

  const goal = water?.goalMl ?? settings?.water.goalMl ?? 2000;
  const glass = settings?.water.glassMl ?? 250;
  const timerLeft = timer?.endsAt ? timer.endsAt - now : (timer?.pausedRemaining ?? 0);
  const timerOn = !!timer && timerLeft > 0 && (timer.endsAt !== null || timer.pausedRemaining !== null);
  const openTodos = todos?.filter((t) => !t.done) ?? [];
  const nextReminder = (reminders ?? [])
    .map((r) => ({ r, at: nextOccurrence(r, now) ?? Infinity }))
    .filter((x) => x.at !== Infinity)
    .sort((a, b) => a.at - b.at)[0];

  const showRamadan = !!ramadan && ramadan.settings.enabled && (ramadan.phase === 'during' || ramadan.daysUntil <= 120);
  const name = profile?.name.trim();

  const cards: Record<HomeCardId, React.ReactNode> = {
    date: <DateCard key="date" day={day} profile={profile} weather={weather} onAvatar={() => go('calendar')} />,

    next: (
      <div key="next" className="n-stack">
        {snapshot ? (
          <PrayerArc days={days} now={now} tz={tz} use24={use24} location={snapshot.activeLocation.name} weather={weather} onOpen={() => go('prayer')} />
        ) : (
          <section className="n-arc n-arc--loading">Calculating prayer times…</section>
        )}
        {snapshot && (
          <div className="n-day">
            {snapshot.today.entries
              .filter((e) => e.prayer !== 'sunrise')
              .map((e) => {
                const passed = Date.parse(e.time) <= now;
                const isNext = next?.entry.prayer === e.prayer && next.date === snapshot.today.date;
                const t = splitTime(formatTime(e.time, tz, use24));
                return (
                  <button
                    key={e.prayer}
                    className={`n-day__item ${isNext ? 'is-next' : ''} ${passed ? 'is-past' : ''}`}
                    onClick={() => (passed ? setMarking({ date: snapshot.today.date, prayer: e.prayer as SalahPrayer, status: salahToday.status(snapshot.today.date, e.prayer) }) : go('prayer'))}
                  >
                    <span className="n-day__name">{PRAYER_NAMES[e.prayer]}</span>
                    <span className="n-day__time">
                      {t.t}
                      {t.p && <small>{t.p}</small>}
                    </span>
                    {e.jamaat && <span className="n-day__j">J {splitTime(formatTime(e.jamaat, tz, use24)).t}</span>}
                    <span className="n-day__state">{passed ? <SalahDot status={salahToday.status(snapshot.today.date, e.prayer)} size={16} /> : isNext ? <i /> : null}</span>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    ),

    shortcuts: <ShortcutsCard key="shortcuts" water={water ?? null} goal={goal} glass={glass} timer={timer ?? null} now={now} onOpen={(t) => go('routine', t)} />,

    friday: new Date(`${today}T12:00:00`).getDay() === 5 ? <FridayCard key="friday" date={today} onKahf={() => push({ kind: 'quran', surah: 18 })} /> : null,

    ayah: <AyahCard key="ayah" date={today} onOpen={(s, a) => push({ kind: 'quran', surah: s, ayah: a })} />,

    ramadan: showRamadan && ramadan ? <RamadanCard key="ramadan" status={ramadan} now={now} tz={tz} use24={use24} onOpen={() => push({ kind: 'ramadan' })} /> : null,

    occasions: (
      <div key="occasions">
        <SectionTitle
          action={
            <button className="n-link" onClick={() => go('calendar')}>
              Calendar
            </button>
          }
        >
          Special days
        </SectionTitle>
        <OccasionsCard items={occasions ?? []} onOpen={() => go('calendar')} />
      </div>
    ),

    photos: (
      <div key="photos">
        <SectionTitle>My photos</SectionTitle>
        <PhotosCard profile={profile} />
      </div>
    ),

    today: (
      <div key="today">
        <SectionTitle>Today</SectionTitle>
        <div className="n-tiles">
          <div className="n-tile" onClick={() => go('routine', 'water')} role="button" tabIndex={0}>
            <div className="n-tile__top">
              <span className="n-tile__icon">
                <NIcon name="drop" size={16} stroke={2} />
              </span>
              <button
                className="n-chip n-chip--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  void w.waterAdd(glass);
                }}
              >
                +{glass}
              </button>
            </div>
            <strong>{((water?.totalMl ?? 0) / 1000).toFixed(1)} L</strong>
            <span>of {(goal / 1000).toFixed(1)} L water</span>
            <span className="n-meter">
              <i style={{ width: `${Math.min(100, ((water?.totalMl ?? 0) / Math.max(1, goal)) * 100)}%` }} />
            </span>
          </div>

          <div className="n-tile" onClick={() => go('routine', 'timer')} role="button" tabIndex={0}>
            <div className="n-tile__top">
              <span className="n-tile__icon">
                <NIcon name="timer" size={16} stroke={2} />
              </span>
              <button
                className="n-chip n-chip--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (timerOn && timer) void w.timerAction(timer.endsAt ? 'pause' : 'resume');
                  else void w.timerStart(25 * 60_000, 'Focus');
                }}
              >
                {timerOn ? (timer?.endsAt ? 'Pause' : 'Resume') : 'Start'}
              </button>
            </div>
            <strong className="n-mono">{timerOn ? formatMs(timerLeft) : '25:00'}</strong>
            <span>{timerOn ? timer?.label || 'Timer' : 'Focus timer'}</span>
          </div>

          <div className="n-tile" onClick={() => go('routine', 'reminders')} role="button" tabIndex={0}>
            <div className="n-tile__top">
              <span className="n-tile__icon">
                <NIcon name="bell" size={16} stroke={2} />
              </span>
            </div>
            <strong>{nextReminder ? inLabel(nextReminder.at - now).replace('in ', '') : '—'}</strong>
            <span>{nextReminder ? nextReminder.r.title : 'No reminders'}</span>
          </div>

          <div className="n-tile" onClick={() => go('routine', 'todo')} role="button" tabIndex={0}>
            <div className="n-tile__top">
              <span className="n-tile__icon">
                <NIcon name="list" size={16} stroke={2} />
              </span>
            </div>
            <strong>{openTodos.length ? `${openTodos.length} open` : 'All clear'}</strong>
            <span>{openTodos.length ? openTodos[0].title : 'To-do'}</span>
          </div>
        </div>
      </div>
    ),

    coming: (
      <div key="coming">
        <SectionTitle
          action={
            <button className="n-link" onClick={() => push({ kind: 'upcoming' })}>
              See all
            </button>
          }
        >
          Coming up
        </SectionTitle>
        <List>
          {upcoming.length === 0 && <div className="n-row n-row--muted">Nothing scheduled yet.</div>}
          {upcoming.map((u, i) => (
            <div className="n-row n-row--icon" key={i}>
              <span className={`n-row__icon n-kind--${u.kind}`}>
                <NIcon name={KIND_ICON[u.kind] ?? 'bell'} size={16} stroke={2} />
              </span>
              <span className="n-row__text">
                <span className="n-row__title">{u.title}</span>
                <span className="n-row__detail">{u.body}</span>
              </span>
              <span className="n-row__right n-mono">{new Date(u.fireAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !use24 })}</span>
            </div>
          ))}
        </List>
      </div>
    ),
  };

  return (
    <div className="n-screen n-home">
      <SalahMarkSheet target={marking} onClose={() => setMarking(null)} />
      <header className="n-homehead">
        <button className="n-homehead__who" onClick={() => setProfileOpen(true)} aria-label="Edit my profile">
          <Avatar profile={profile} size={46} />
          <span>
            <small>{greeting()}</small>
            <strong>{name || 'Assalamu alaikum'}</strong>
          </span>
        </button>
        <button className="n-iconbtn n-iconbtn--lg" onClick={() => push({ kind: 'settings' })} aria-label="Settings">
          <NIcon name="settings" size={21} />
        </button>
      </header>

      {permission && permission !== 'granted' && (
        <Card className="n-banner" onClick={() => void askPermission()}>
          <NIcon name="bell" size={22} />
          <div>
            <strong>Turn on reminders</strong>
            <span>Allow notifications so prayer times, Sehri &amp; Iftar and your reminders ring — even when Noor is closed.</span>
          </div>
          <NIcon name="chevronRight" size={18} />
        </Card>
      )}
      {prayerError && <Card className="n-error">{prayerError}</Card>}

      {layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => cards[id])}

      <button className="n-customize" onClick={() => setEditing(true)}>
        <NIcon name="layout" size={16} /> Customize Home
      </button>

      <HomeEditor open={editing} layout={layout} onChange={setLayout} onClose={() => setEditing(false)} />
      <ProfileSheet open={profileOpen} profile={profile} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
