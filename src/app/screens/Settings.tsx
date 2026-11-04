import { useEffect, useState } from 'react';
import { api, errorText } from '../../island/lib/ipc';
import { noor, type SoundInfo } from '../api';
import { useNoor } from '../context';
import { NIcon } from '../icons';
import { openAppSettings, playSound } from '../sound';
import { Card, List, ListRow, Page, SectionTitle, Switch } from '../ui';
import type { ThemeChoice } from '../theme';
import { ACCENTS, resolveAccent } from '../accent';

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'glass', label: 'Glass' },
];

import { useWidgetData, w } from '../../island/lib/widgets';
import { places } from '../places';
import { useHomeLayout } from '../hooks';
import { HomeEditor } from './home/HomeEditor';
import { BackupSection } from './BackupSection';
import { liveEnabled, liveStepsEnabled, liveSupported, setLiveEnabled, setLiveStepsEnabled } from '../live';
import { isIOS } from '../../kit/utils/platform';

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const { permission, askPermission, flash, push, snapshot, reloadPrayer, go, theme, setTheme } = useNoor();
  const [sounds, setSounds] = useState<SoundInfo[]>([]);
  const [layout, setLayout] = useHomeLayout();
  const [homeEdit, setHomeEdit] = useState(false);
  const [live, setLive] = useState(liveEnabled);
  const [liveSteps, setLiveSteps] = useState(liveStepsEnabled);
  const [liveOk, setLiveOk] = useState<boolean | null>(null);
  useEffect(() => {
    void liveSupported().then(setLiveOk);
  }, [live]);
  const [testSound, setTestSound] = useState('noor_chime');
  const [count, setCount] = useState<number | null>(null);
  const { data: settings } = useWidgetData('settings', w.settings);
  const { data: quiet } = useWidgetData('places', places.list);

  useEffect(() => {
    void noor.sounds().then(setSounds).catch(() => undefined);
    void noor.upcoming().then((u) => setCount(u.length)).catch(() => undefined);
  }, [snapshot, settings]);

  const test = async () => {
    try {
      if (permission !== 'granted') {
        const p = await askPermission();
        if (p !== 'granted') {
          flash('Notifications are off — allow them in Settings');
          return;
        }
      }
      await noor.test({ sound: testSound, delaySecs: 5 });
      flash('Test arrives in 5 seconds — lock your iPhone to hear it 🔔');
    } catch (e) {
      flash(errorText(e));
    }
  };

  const display = snapshot?.settings.display;
  const set24 = async (v: boolean) => {
    if (!display) return;
    try {
      await api.saveDisplay({ ...display, use24Hour: v });
      if (settings) await w.saveSettings({ ...settings, use24Hour: v });
      await reloadPrayer();
    } catch (e) {
      flash(errorText(e));
    }
  };

  const setAccent = async (accent: string) => {
    if (!display) return;
    try {
      await api.saveDisplay({ ...display, accent });
      await reloadPrayer();
    } catch (e) {
      flash(errorText(e));
    }
  };

  const status =
    permission === 'granted' ? (
      <span className="n-ok">On</span>
    ) : permission === 'denied' ? (
      <span className="n-bad">Off</span>
    ) : (
      <span className="n-warn">Not set</span>
    );

  return (
    <Page title="Settings" onBack={onBack}>
      <div className="n-pad-x">
      <SectionTitle>Appearance</SectionTitle>
      <Card className="n-stack">
        <div className="n-themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={theme === t.id} className={`n-theme ${theme === t.id ? 'is-on' : ''}`} onClick={() => setTheme(t.id)}>
              <span className={`n-theme__swatch n-theme__swatch--${t.id}`}>
                <i />
                <i />
              </span>
              {t.label}
            </button>
          ))}
        </div>
        <div className="n-line">
          <span className="n-muted">Accent</span>
          <div className="n-colors">
            {ACCENTS.map((c) => (
              <button key={c} className={resolveAccent(display?.accent) === c ? 'is-on' : ''} style={{ background: c }} onClick={() => void setAccent(c)} aria-label={`Accent ${c}`} />
            ))}
          </div>
        </div>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <List>
        <ListRow
          icon="bell"
          title="Notifications"
          detail={
            permission === 'denied'
              ? 'Blocked in iOS Settings — tap to open'
              : permission === 'granted'
                ? `${count ?? '…'} queued with iOS · refreshed when you open Noor`
                : 'Tap to allow banners and sounds'
          }
          right={status}
          onClick={() => (permission === 'denied' ? void openAppSettings() : permission === 'granted' ? push({ kind: 'upcoming' }) : void askPermission())}
        />
        <ListRow icon="moon" title="Prayer reminders & sounds" onClick={() => push({ kind: 'prayer-settings', section: 'reminders' })} />
        <ListRow icon="drop" title="Water reminders" detail={settings?.water.reminders ? 'On' : 'Off'} onClick={() => go('routine', 'water')} />
        <ListRow icon="routine" title="Personal reminders" onClick={() => go('routine', 'reminders')} />
        <ListRow icon="bellOff" title="Quiet places" detail={quiet?.length ? `${quiet.length} saved · silent on arrival` : 'Silence your phone at the mosque, office…'} onClick={() => go('routine', 'places')} />
      </List>

      <SectionTitle>Sounds</SectionTitle>
      <Card className="n-stack">
        <div className="n-sounds">
          {sounds.map((s) => (
            <button
              key={s.id}
              className={testSound === s.id ? 'is-on' : ''}
              onClick={() => {
                setTestSound(s.id);
                void playSound(s.id);
              }}
            >
              <NIcon name="sound" size={15} />
              {s.label}
            </button>
          ))}
        </div>
        <button className="n-btn n-btn--primary" onClick={() => void test()}>
          <NIcon name="bell" size={18} /> Send a test notification
        </button>
        <p className="n-hint">Tip: if your iPhone is on silent, banners still appear but without sound. Focus modes can hold notifications back.</p>
      </Card>

      <SectionTitle>General</SectionTitle>
      <List>
        <ListRow title="24-hour clock" right={<Switch checked={!!display?.use24Hour} onChange={(v) => void set24(v)} />} />
        <ListRow icon="pin" title="Location" detail={snapshot?.activeLocation.name} onClick={() => push({ kind: 'prayer-settings', section: 'location' })} />
        <ListRow icon="settings" title="iOS Settings for Noor" detail="Notifications, location, photos" onClick={() => void openAppSettings()} />
      </List>

      <SectionTitle>Home screen</SectionTitle>
      <List>
        <ListRow icon="layout" title="Home content" detail={`${layout.order.length - layout.hidden.length} of ${layout.order.length} sections shown — show, hide, reorder`} onClick={() => setHomeEdit(true)} />
      </List>
      <List>
        <ListRow
          icon="moonStar"
          title="Prayer on lock screen"
          detail="Current prayer, countdown and today’s times on the lock screen and Dynamic Island"
          chevron={false}
          right={
            <Switch
              checked={live}
              onChange={(v) => {
                setLive(v);
                setLiveEnabled(v);
                flash(v ? 'Prayer times now on your lock screen 🌙' : 'Removed from the lock screen');
              }}
            />
          }
        />
        {live && (
          <ListRow
            icon="heart"
            title="Steps on lock screen"
            detail="Today’s steps and goal under the prayer times — updates whenever Noor is opened"
            chevron={false}
            right={
              <Switch
                checked={liveSteps}
                onChange={(v) => {
                  setLiveSteps(v);
                  setLiveStepsEnabled(v);
                }}
              />
            }
          />
        )}
      </List>
      {live && isIOS() && liveOk === false && (
        <p className="n-hint">Live Activities look switched off for Noor — turn them on in Settings › Noor › Live Activities (iOS 16.2 or later).</p>
      )}
      <HomeEditor open={homeEdit} layout={layout} onChange={setLayout} onClose={() => setHomeEdit(false)} />

      <SectionTitle>Ramadan &amp; calendar</SectionTitle>
      <List>
        <ListRow icon="sunrise" title="Ramadan" detail="Sehri & Iftar alerts, yearly sync" onClick={() => push({ kind: 'ramadan' })} />
        <ListRow icon="calendarStar" title="Calendar & holidays" detail="Moon-sighting day, holiday alerts" onClick={() => push({ kind: 'calendar-settings' })} />
      </List>

      <SectionTitle>Studio</SectionTitle>
      <List>
        <ListRow icon="sliders" title="Photo tool settings" detail="Export defaults, naming, limits" onClick={() => push({ kind: 'tool', id: 'settings' })} />
        <ListRow icon="image" title="Saved files" detail="Files › On My iPhone › Noor" />
      </List>

      <BackupSection />

      <SectionTitle>About</SectionTitle>
      <List>
        <ListRow icon="sparkle" title="About Noor" detail="Version, privacy, credits" onClick={() => push({ kind: 'about' })} />
      </List>
      </div>
    </Page>
  );
}
