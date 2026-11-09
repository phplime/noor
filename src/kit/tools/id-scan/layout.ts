/** A4 at 300 dpi — prints at true size. */
export const PAGE_W = 2480;
export const PAGE_H = 3508;
/** The same page in CSS pixels (96 dpi). The "gap" setting is in these units. */
export const PAGE_CSS_W = 794;
const DPI = 300;
const mm = (v: number) => Math.round((v / 25.4) * DPI);

export type DocType = 'nid' | 'passport' | 'large';

export const DOC_TYPES: { id: DocType; label: string; hint: string; widthMm: number }[] = [
  { id: 'nid', label: 'NID card', hint: 'Actual card size (85.6 × 54 mm)', widthMm: 85.6 },
  { id: 'passport', label: 'Passport', hint: 'Actual passport page size (125 × 88 mm)', widthMm: 125 },
  { id: 'large', label: 'Large', hint: 'Bigger and easier to read (150 mm wide)', widthMm: 150 },
];

export interface Part {
  width: number;
  height: number;
}

export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Centre the parts on the page: each one centred left–right, stacked top to bottom with
 * `gapCss` (CSS px on the A4 page) between them, and the whole group centred top–bottom.
 */
export function placeParts(parts: Part[], type: DocType, gapCss: number): Placed[] {
  if (!parts.length) return [];
  const widthMm = DOC_TYPES.find((d) => d.id === type)?.widthMm ?? 85.6;
  const gap = Math.round((gapCss * PAGE_W) / PAGE_CSS_W);
  let sizes = parts.map((p) => {
    const w = mm(widthMm);
    return { w, h: Math.round((w * p.height) / Math.max(1, p.width)) };
  });
  // Never run off the page (e.g. a portrait photo in passport size): shrink everything evenly.
  const margin = mm(10);
  const total = sizes.reduce((s, z) => s + z.h, 0) + gap * (parts.length - 1);
  const k = Math.min(1, (PAGE_H - 2 * margin) / total, (PAGE_W - 2 * margin) / Math.max(...sizes.map((z) => z.w)));
  if (k < 1) sizes = sizes.map((z) => ({ w: Math.round(z.w * k), h: Math.round(z.h * k) }));
  const used = sizes.reduce((s, z) => s + z.h, 0) + gap * (parts.length - 1);
  let y = Math.round((PAGE_H - used) / 2);
  return sizes.map((z) => {
    const r = { x: Math.round((PAGE_W - z.w) / 2), y, w: z.w, h: z.h };
    y += z.h + gap;
    return r;
  });
}

/** Width / height of the real document, used to straighten it to the right shape. */
export function docAspect(type: DocType): number {
  return type === 'passport' ? 125 / 88 : 85.6 / 54;
}

/** Corner radius as a fraction of the card's width (ID-1 cards: 3.18 mm on 85.6 mm). */
export function cornerRadius(type: DocType): number {
  return type === 'passport' ? 0.02 : 3.18 / 85.6;
}
