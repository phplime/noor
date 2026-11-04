import { useEffect, useState } from 'react';
import { errorText } from '../../../island/lib/ipc';
import { MONTHS_EN, cal, type Profile } from '../../calendar';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { pickPhoto } from '../../photos';
import { Sheet } from '../../ui';

export function Avatar({ profile, size = 44 }: { profile: Profile | null; size?: number }) {
  const initial = (profile?.name.trim()[0] ?? '').toUpperCase();
  return (
    <span className="n-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {profile?.avatar ? <img src={profile.avatar} alt="" /> : initial || <NIcon name="user" size={size * 0.5} />}
    </span>
  );
}

/** Edit name, photo, cover and birthday. Everything stays on this iPhone. */
export function ProfileSheet({ open, profile, onClose }: { open: boolean; profile: Profile | null; onClose: () => void }) {
  const { flash } = useNoor();
  const [draft, setDraft] = useState<Profile | null>(profile);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDraft(profile);
  }, [open, profile]);

  if (!open || !draft) return null;
  const set = (patch: Partial<Profile>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const [bm, bd] = (draft.birthday ?? '').split('-').map(Number);

  const choose = async (kind: 'avatar' | 'cover') => {
    try {
      const p = await pickPhoto(kind);
      if (p) set({ [kind]: p } as Partial<Profile>);
    } catch (e) {
      flash(errorText(e));
    }
  };

  const setBirthday = (m: number, d: number) => set({ birthday: m && d ? `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null });

  const save = async () => {
    setBusy(true);
    try {
      await cal.profileSave(draft);
      onClose();
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="My profile"
      actions={
        <button className="n-link n-link--strong" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      }
    >
      <div className="n-form">
        <div className="n-profile">
          <button className="n-profile__avatar" onClick={() => void choose('avatar')} aria-label="Change photo">
            <Avatar profile={draft} size={84} />
            <span className="n-profile__cam">
              <NIcon name="camera" size={14} stroke={2.2} />
            </span>
          </button>
          {draft.avatar && (
            <button className="n-link n-link--danger" onClick={() => set({ avatar: null })}>
              Remove photo
            </button>
          )}
        </div>

        <label className="n-field">
          <span>Your name</span>
          <input className="n-input" value={draft.name} maxLength={60} placeholder="e.g. Nazmul" onChange={(e) => set({ name: e.target.value })} />
        </label>

        <div className="n-field">
          <span>Birthday</span>
          <div className="n-form__grid">
            <select className="n-input" value={bm || 0} onChange={(e) => setBirthday(+e.target.value, bd || 1)}>
              <option value={0}>Not set</option>
              {MONTHS_EN.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select className="n-input" value={bd || 0} disabled={!bm} onChange={(e) => setBirthday(bm, +e.target.value)}>
              {!bd && <option value={0}>Day</option>}
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="n-field">
          <span>Cover photo (behind today’s date)</span>
          <button className="n-cover" style={draft.cover ? { backgroundImage: `url(${draft.cover})` } : undefined} onClick={() => void choose('cover')}>
            {!draft.cover && (
              <>
                <NIcon name="image" size={22} /> Choose a cover
              </>
            )}
          </button>
          {draft.cover && (
            <button className="n-link n-link--danger" onClick={() => set({ cover: null })}>
              Remove cover
            </button>
          )}
        </div>
        <p className="n-hint">Your name, photos and birthday are stored only on this iPhone.</p>
      </div>
    </Sheet>
  );
}
