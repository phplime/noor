import { BANGLA_WEEKDAYS, MONTHS_EN, banglaLong, banglaSeason, hijriBn, occasionName, parseYmd, topOccasion, type DayInfo, type Profile } from '../../calendar';
import { NIcon } from '../../icons';
import { WEATHER_LABEL, type Weather } from '../../weather';

const TAG: Record<string, string> = { holiday: 'Public holiday', islamic: 'Islamic occasion', fasting: 'Sunnah fast', special: 'Your special day' };

/** Today's date in English, Bangla and Arabic with the day's holidays highlighted. */
export function DateCard({ day, profile, weather, onAvatar }: { day: DayInfo | null; profile: Profile | null; weather?: Weather | null; onAvatar?: () => void }) {
  if (!day) return <section className="n-date n-date--loading" />;
  const d = parseYmd(day.date);
  const top = topOccasion(day.occasions);
  const cover = profile?.cover;
  const isBirthday = !!profile?.birthday && profile.birthday === day.date.slice(5);
  const holiday = day.occasions.some((o) => o.kind === 'holiday');
  const friday = day.weekday === 5;

  return (
    <section className={`n-date ${cover ? 'has-cover' : ''} ${holiday ? 'is-holiday' : ''}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
      <span className="n-date__shine" aria-hidden="true" />
      <div className="n-date__main">
        <div className="n-date__num" aria-label={`${d.getDate()}`}>
          {d.getDate()}
        </div>
        <div className="n-date__en">
          <strong>{d.toLocaleDateString('en-GB', { weekday: 'long' })}</strong>
          <span>
            {MONTHS_EN[d.getMonth()]} {d.getFullYear()}
          </span>
          {weather && (
            <span className="n-date__wx" title={`Feels like ${weather.feels}°`}>
              <i aria-hidden="true">{WEATHER_LABEL[weather.kind].icon}</i>
              <b>{weather.temp}°C</b>
              <small>
                {WEATHER_LABEL[weather.kind].en} · <span lang="bn">{WEATHER_LABEL[weather.kind].bn}</span> · H {weather.high}° L {weather.low}°
                {weather.rainChance >= 30 ? ` · ☔ ${weather.rainChance}%` : ''}
              </small>
            </span>
          )}
          {friday && <em className="n-date__jumuah">Jumu’ah mubarak</em>}
        </div>
        {onAvatar && (
          <button className="n-date__cal" onClick={onAvatar} aria-label="Open calendar">
            <NIcon name="calendarStar" size={20} />
          </button>
        )}
      </div>

      <div className="n-date__langs">
        <div className="n-date__line n-date__line--bn" lang="bn">
          <i>বাংলা</i>
          <span>
            {BANGLA_WEEKDAYS[day.weekday]}, {banglaLong(day.bangla)}
          </span>
          <small>{banglaSeason(day.bangla)}কাল</small>
        </div>
        <div className="n-date__line n-date__line--hijri" lang="bn">
          <i>আরবি</i>
          <span>{hijriBn(day.hijri)}</span>
        </div>
      </div>

      {(isBirthday || day.occasions.length > 0) && (
        <div className="n-date__occ">
          {isBirthday && (
            <div className="n-occ n-occ--special">
              <NIcon name="gift" size={16} />
              <span>
                <b>Happy birthday{profile?.name ? `, ${profile.name}` : ''} 🎂</b>
                <small>May this year be full of barakah</small>
              </span>
            </div>
          )}
          {day.occasions
            .filter((o) => o.kind !== 'fasting' || day.occasions.length === 1)
            .slice(0, 3)
            .map((o) => (
              <div key={o.key} className={`n-occ n-occ--${o.kind}`}>
                <NIcon name={o.kind === 'special' ? 'gift' : o.kind === 'fasting' ? 'moon' : 'sparkle'} size={16} />
                <span>
                  <b>{occasionName(o)}</b>
                  <small>
                    {o.bn && <span lang="bn">{o.bn}</span>}
                    {o.bn && o.ar && ' · '}
                    {o.ar && <span lang="ar">{o.ar}</span>}
                    {!o.bn && !o.ar && TAG[o.kind]}
                  </small>
                </span>
                <em>{o === top ? TAG[o.kind] : ''}</em>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
