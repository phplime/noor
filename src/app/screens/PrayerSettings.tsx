import { CalculationSection } from '../../island/center/CalculationSection';
import { DisplaySection } from '../../island/center/DisplaySection';
import { LocationSection } from '../../island/center/LocationSection';
import { RemindersSection } from '../../island/center/RemindersSection';
import { TimetableSection } from '../../island/center/TimetableSection';
import { useNoor, type PrayerSection } from '../context';
import { Page } from '../ui';

const TITLES: Record<PrayerSection, string> = {
  reminders: 'Reminders & sounds',
  location: 'Location',
  calculation: 'Calculation',
  display: 'Display',
  timetable: 'Adjust times',
};

/**
 * Nexa Island's Prayer Center sections, unchanged, inside Noor. Their styles are
 * scoped to `.ni-scope` (see vite.config.ts) and adapted to the phone in noor.css.
 */
export function PrayerSettingsPage({ section, onBack }: { section: PrayerSection; onBack: () => void }) {
  const { snapshot, reloadPrayer } = useNoor();
  return (
    <Page title={TITLES[section]} onBack={onBack}>
      <div className="ni-scope n-ni">
        <div className="center">
          <main className="content">
            {!snapshot ? (
              <div className="loading">Loading…</div>
            ) : (
              <>
                {section === 'reminders' && <RemindersSection snapshot={snapshot} />}
                {section === 'location' && <LocationSection snapshot={snapshot} reload={reloadPrayer} />}
                {section === 'calculation' && <CalculationSection snapshot={snapshot} />}
                {section === 'display' && <DisplaySection snapshot={snapshot} />}
                {section === 'timetable' && <TimetableSection snapshot={snapshot} />}
              </>
            )}
          </main>
        </div>
      </div>
    </Page>
  );
}
