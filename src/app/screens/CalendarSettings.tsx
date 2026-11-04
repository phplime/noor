import { errorText } from '../../island/lib/ipc';
import { cal, hijriAr, hijriEn, type CalendarSettings } from '../calendar';
import { useNoor } from '../context';
import { useLoad, useToday } from '../hooks';
import { List, ListRow, Page, Switch } from '../ui';

const ADJUST = [-2, -1, 0, 1, 2];

export function CalendarSettingsPage({ onBack }: { onBack: () => void }) {
  const { flash } = useNoor();
  const today = useToday();
  const { data: s } = useLoad(() => cal.settings(), [], ['calendar']);
  const { data: day } = useLoad(() => cal.day(today), [today, s?.hijriAdjust], ['calendar']);

  const save = async (patch: Partial<CalendarSettings>) => {
    if (!s) return;
    try {
      await cal.saveSettings({ ...s, ...patch });
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <Page title="Calendar & holidays" onBack={onBack}>
      <div className="n-pad-x">
        <div className="n-section">
          <span>Hijri date</span>
        </div>
        <div className="n-card n-stackcard">
          {day && (
            <div className="n-hijriprev">
              <strong lang="ar" dir="rtl">
                {hijriAr(day.hijri)}
              </strong>
              <span>{hijriEn(day.hijri)}</span>
            </div>
          )}
          <div className="n-choice n-choice--row">
            {ADJUST.map((a) => (
              <button key={a} className={s?.hijriAdjust === a ? 'is-on' : ''} onClick={() => void save({ hijriAdjust: a })}>
                {a > 0 ? `+${a}` : a}
              </button>
            ))}
          </div>
          <p className="n-hint">
            Islamic months begin when the moon is sighted, so the date can differ by a day between countries. In Bangladesh the new moon is usually sighted a day after Saudi Arabia — choose −1 if
            your Hijri date is one day ahead. Eid, Shab-e-Barat, Shab-e-Qadr and your Ramadan alerts all follow this setting.
          </p>
        </div>

        <div className="n-section">
          <span>Alerts &amp; display</span>
        </div>
        <List>
          <ListRow
            icon="bell"
            title="Holiday alerts"
            detail="A notification at 8 pm the evening before every public holiday"
            chevron={false}
            right={<Switch checked={!!s?.holidayAlerts} onChange={(v) => void save({ holidayAlerts: v })} />}
          />
          <ListRow
            icon="moon"
            title="Sunnah fasting days"
            detail="Show Ayyam al-Bid, Arafah and Tasu’a in the calendar"
            chevron={false}
            right={<Switch checked={!!s?.showFastingDays} onChange={(v) => void save({ showFastingDays: v })} />}
          />
          <ListRow
            icon="calendar"
            title="Monday & Thursday fasts"
            detail="Also mark every Monday and Thursday (not in Ramadan or on Eid days)"
            chevron={false}
            right={<Switch checked={!!s?.mondayThursday} onChange={(v) => void save({ mondayThursday: v })} />}
          />
          <ListRow
            icon="alarm"
            title="Fasting reminders"
            detail="9 pm the evening before a Sunnah fast, with the Sehri end time"
            chevron={false}
            right={<Switch checked={!!s?.fastingAlerts} onChange={(v) => void save({ fastingAlerts: v })} />}
          />
        </List>

        <div className="n-section">
          <span>No-salah times · নিষিদ্ধ সময়</span>
        </div>
        <List>
          <ListRow
            icon="info"
            title="No-salah time alerts"
            detail="A notification when sunrise, zawal and sunset makruh times start and end"
            chevron={false}
            right={<Switch checked={!!s?.makruhAlerts} onChange={(v) => void save({ makruhAlerts: v })} />}
          />
        </List>

        <div className="n-section">
          <span>Jumu'ah · জুমা</span>
        </div>
        <List>
          <ListRow
            icon="mosque"
            title="Friday reminders"
            detail="Surah Al-Kahf in the morning, Jumu'ah 1 hour before, durud after Asr"
            chevron={false}
            right={<Switch checked={!!s?.fridayReminders} onChange={(v) => void save({ fridayReminders: v })} />}
          />
          {s?.fridayReminders && (
            <ListRow
              icon="book"
              title="Al-Kahf reminder time"
              chevron={false}
              right={<input className="n-input n-input--time n-input--inline" type="time" value={s.kahfTime} onChange={(e) => e.target.value && void save({ kahfTime: e.target.value })} />}
            />
          )}
        </List>
        <p className="n-hint">
          Bangla dates follow Bangladesh’s revised calendar (Pohela Boishakh is always 14 April). National days are fixed; moon-dependent holidays are estimates — adjust above to match the official
          announcement.
        </p>
      </div>
    </Page>
  );
}
