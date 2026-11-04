/** Pick a photo from the library and shrink it to a small JPEG data URL (kept in Noor's own storage). */

export type PhotoKind = 'avatar' | 'cover' | 'photo';

const SPEC: Record<PhotoKind, { w: number; h: number; q: number; crop: boolean }> = {
  avatar: { w: 320, h: 320, q: 0.82, crop: true },
  cover: { w: 1000, h: 560, q: 0.74, crop: true },
  photo: { w: 900, h: 900, q: 0.76, crop: false },
};

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be opened'));
    };
    img.src = url;
  });
}

export async function shrink(file: File, kind: PhotoKind): Promise<string> {
  const img = await load(file);
  const { w, h, q, crop } = SPEC[kind];
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  let sx = 0;
  let sy = 0;
  let dw: number;
  let dh: number;
  if (crop) {
    // cover-crop to w×h
    const target = w / h;
    if (sw / sh > target) {
      const nw = sh * target;
      sx = (sw - nw) / 2;
      sw = nw;
    } else {
      const nh = sw / target;
      sy = (sh - nh) / 2;
      sh = nh;
    }
    dw = w;
    dh = h;
  } else {
    const k = Math.min(1, w / sw, h / sh);
    dw = Math.round(sw * k);
    dh = Math.round(sh * k);
  }
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas.toDataURL('image/jpeg', q);
}

/** Open the system photo picker. Resolves to null if the user cancels. */
export function pickPhoto(kind: PhotoKind): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const done = (v: string | null, err?: unknown) => {
      if (settled) return;
      settled = true;
      input.remove();
      if (err) reject(err);
      else resolve(v);
    };
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return done(null);
      shrink(f, kind).then((v) => done(v), (e) => done(null, e));
    };
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}
