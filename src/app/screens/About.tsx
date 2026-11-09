import { openUrl } from '@tauri-apps/plugin-opener';
import { useApp } from '../../kit/app/AppContext';
import { cal } from '../calendar';
import { useLoad } from '../hooks';
import { NIcon } from '../icons';
import { Avatar } from './home/ProfileSheet';
import { NoorMark } from '../icons';
import { Card, Page } from '../ui';
import { useState } from 'react';
import { clearErrors, readErrors } from '../Guard';
import { useNoor } from '../context';

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
        <div className="n-muted" style={{ fontSize: 12 }}>
          Built {new Date(__BUILD_TIME__).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
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
        <ProblemLog />
        <div className="n-muted n-small">Prayer-time formulas: PrayTimes.org (Hamid Zarrabi-Zadeh). City data: city-timezones (MIT). Fonts: DejaVu, Scheherazade New & Amiri Quran (OFL). Qur’an: Uthmani text (The Noble Qur’an Encyclopedia), Bangla meaning by Muhiuddin Khan (tanzil.net), English meaning Saheeh International, via quran-json (CC-BY-SA 4.0). Weather: Open-Meteo.com (CC BY 4.0). Maps © OpenStreetMap.</div>
      </div>
    </Page>
  );
}

/** Errors the crash guard caught, so a freeze or blank screen can be traced. */
function ProblemLog() {
  const { flash } = useNoor();
  const [list, setList] = useState(readErrors);
  if (!list.length) return null;
  const text = list.map((e) => `${e.at} [${e.where}] ${e.message}\n${e.stack ?? ''}`).join('\n\n');
  return (
    <Card className="n-stack n-about__card n-problems">
      <strong>Recent problems ({list.length})</strong>
      <span>Noor recovered from these. Copy and send them to fix the cause.</span>
      <ul>
        {list.slice(0, 5).map((e) => (
          <li key={e.at + e.message}>
            <small>
              {new Date(e.at).toLocaleString()} · {e.where}
            </small>
            {e.message}
          </li>
        ))}
      </ul>
      <div className="n-row">
        <button
          className="n-chip"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(text)
              .then(() => flash('Copied'))
              .catch(() => flash('Could not copy'))
          }
        >
          <NIcon name="list" size={14} /> Copy details
        </button>
        <button
          className="n-chip"
          onClick={() => {
            clearErrors();
            setList([]);
          }}
        >
          <NIcon name="trash" size={14} /> Clear
        </button>
      </div>
    </Card>
  );
}
