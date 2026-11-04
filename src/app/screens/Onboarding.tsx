import { useState } from 'react';
import { api, errorText } from '../../island/lib/ipc';
import { useNoor } from '../context';
import { NIcon, NoorMark } from '../icons';

/** First launch: what Noor does + the two permissions that matter. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { askPermission, permission, snapshot, reloadPrayer } = useNoor();
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setLocMsg('Location is not available — you can pick a city later.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const loc = await api.setDeviceLocation(pos.coords.latitude, pos.coords.longitude);
          await reloadPrayer();
          setLocMsg(`📍 ${loc.name}`);
        } catch (e) {
          setLocMsg(errorText(e));
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setLocMsg('No problem — you can choose a city in Prayer › Location.');
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };

  return (
    <div className="n-onboard">
      <div className="n-onboard__glow" />
      <div className="n-onboard__body">
        <NoorMark size={92} />
        <h1>Welcome to Noor</h1>
        <p className="n-onboard__lead">Prayer times, gentle reminders and a private photo studio — all on your iPhone.</p>

        <div className="n-onboard__list">
          <div>
            <NIcon name="moon" size={22} />
            <span>
              <b>Prayer times that ring</b> — before, at or after each prayer, with the sound you choose.
            </span>
          </div>
          <div>
            <NIcon name="routine" size={22} />
            <span>
              <b>Your routine</b> — reminders, water, timer, to-do and world clocks.
            </span>
          </div>
          <div>
            <NIcon name="tools" size={22} />
            <span>
              <b>Studio</b> — watermark, crop, resize, compress, enhance, remove backgrounds, collages.
            </span>
          </div>
        </div>

        <div className="n-onboard__actions">
          <button className={`n-btn ${permission === 'granted' ? 'n-btn--done' : 'n-btn--primary'}`} onClick={() => void askPermission()}>
            <NIcon name={permission === 'granted' ? 'check' : 'bell'} size={18} />
            {permission === 'granted' ? 'Notifications on' : 'Allow notifications'}
          </button>
          <button className="n-btn n-btn--ghost" disabled={locating} onClick={locate}>
            <NIcon name="pin" size={18} />
            {locating ? 'Finding you…' : locMsg ?? `Use my location${snapshot ? ` (now: ${snapshot.activeLocation.name})` : ''}`}
          </button>
          <button className="n-link n-link--strong" onClick={onDone}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
