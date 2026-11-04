import { openUrl } from '@tauri-apps/plugin-opener';
import { useApp } from '../../kit/app/AppContext';
import { cal } from '../calendar';
import { useLoad } from '../hooks';
import { NIcon } from '../icons';
import { Avatar } from './home/ProfileSheet';
import { NoorMark } from '../icons';
import { Card, Page } from '../ui';

export function AboutPage({ onBack }: { onBack: () => void }) {
  const { appInfo } = useApp();
  const { data: profile } = useLoad(() => cal.profile(), [], ['profile']);
  const open = (url: string) => void openUrl(url).catch(() => undefined);
  return (
    <Page title="About" onBack={onBack}>
      <div className="n-about">
        <NoorMark size={96} />
        <h2>Noor</h2>
        <div className="n-muted">Version {appInfo.version} · نور — “light”</div>
        <p>
          One calm app for your day: accurate prayer times with reminders that ring, a Qibla compass, water, timer, to-do,
          world clocks and personal reminders — plus a full photo studio.
        </p>
        <Card className="n-about__card n-author">
          <Avatar profile={profile} size={56} />
          <div className="n-author__text">
            <strong>Nazmul</strong>
            <span>Web application developer · PHP (CodeIgniter, Laravel) &amp; frontend</span>
            <span>Author “codetrick” on CodeCanyon</span>
          </div>
          <div className="n-author__links">
            <button className="n-chip" onClick={() => open('https://www.linkedin.com/in/nazmulnm')}>
              <NIcon name="globe" size={14} /> LinkedIn
            </button>
            <button className="n-chip" onClick={() => open('https://codecanyon.net/user/codetrick/portfolio')}>
              <NIcon name="globe" size={14} /> CodeCanyon
            </button>
          </div>
        </Card>
        <Card className="n-stack n-about__card">
          <strong>Built from two apps</strong>
          <span>
            <b>Nexa Island</b> — prayer engine (PrayTimes.org method, 12 calculation methods, offline city search), water, timer,
            clocks and to-do.
          </span>
          <span>
            <b>MacKit</b> — watermark, crop, resize & canvas, batch, compression, format converter, adjust & enhance, background
            removal, collage, Facebook post designer and notes.
          </span>
        </Card>
        <Card className="n-stack n-about__card">
          <strong>Private by design</strong>
          <span>Everything is calculated and processed on your iPhone. No account, no tracking, no uploads. The only things fetched online are the weather on Home (your saved prayer location is sent to Open-Meteo) and map tiles in Places. Your data lives in the app’s own storage; edited photos are saved to Files › On My iPhone › Noor.</span>
        </Card>
        <div className="n-muted n-small">Prayer-time formulas: PrayTimes.org (Hamid Zarrabi-Zadeh). City data: city-timezones (MIT). Fonts: DejaVu, Scheherazade New & Amiri Quran (OFL). Qur’an: Uthmani text (The Noble Qur’an Encyclopedia), Bangla meaning by Muhiuddin Khan (tanzil.net), via quran-json (CC-BY-SA 4.0). Weather: Open-Meteo.com (CC BY 4.0). Maps © OpenStreetMap.</div>
      </div>
    </Page>
  );
}
