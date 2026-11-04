import { useState } from 'react';
import { errorText } from '../../../island/lib/ipc';
import { cal, type Profile } from '../../calendar';
import { useNoor } from '../../context';
import { NIcon } from '../../icons';
import { pickPhoto } from '../../photos';
import { Sheet } from '../../ui';

const MAX = 8;

/** Horizontal strip of the person's own photos with an add tile and a full-screen viewer. */
export function PhotosCard({ profile }: { profile: Profile | null }) {
  const { flash } = useNoor();
  const [open, setOpen] = useState<number | null>(null);
  const photos = profile?.photos ?? [];

  const save = async (next: string[]) => {
    if (!profile) return;
    try {
      await cal.profileSave({ ...profile, photos: next });
    } catch (e) {
      flash(errorText(e));
    }
  };

  const add = async () => {
    try {
      const p = await pickPhoto('photo');
      if (p) await save([...photos, p]);
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <>
      <div className="n-photos">
        {photos.map((src, i) => (
          <button key={i} className="n-photos__item" onClick={() => setOpen(i)} aria-label={`Photo ${i + 1}`}>
            <img src={src} alt="" loading="lazy" />
          </button>
        ))}
        {photos.length < MAX && (
          <button className={`n-photos__add ${photos.length === 0 ? 'is-wide' : ''}`} onClick={() => void add()}>
            <NIcon name="camera" size={22} />
            <span>{photos.length === 0 ? 'Add your favourite photos' : 'Add'}</span>
          </button>
        )}
      </div>

      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        closeLabel="Close"
        title={open !== null ? `${open + 1} of ${photos.length}` : ''}
        actions={
          <button
            className="n-link n-link--danger"
            onClick={() => {
              if (open === null) return;
              const next = photos.filter((_, i) => i !== open);
              setOpen(null);
              void save(next);
            }}
          >
            Remove
          </button>
        }
      >
        {open !== null && photos[open] && <img className="n-photoview" src={photos[open]} alt="" />}
      </Sheet>
    </>
  );
}
