/**
 * Pure layout helpers for the Facebook post preview: the photo grid Facebook
 * uses for 1–5+ photos, and word wrapping that keeps #hashtags / @mentions as
 * coloured tokens. Kept free of DOM APIs so they can be unit-tested.
 */

export interface Size {
  w: number;
  h: number;
}

export interface Tile {
  /** Index of the photo shown in this tile. */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** "+N" overlay on the last visible tile when more photos are hidden. */
  more: number;
}

export interface Grid {
  width: number;
  height: number;
  tiles: Tile[];
}

const shape = (s: Size) => {
  const r = s.w / s.h;
  return r > 1.15 ? 'landscape' : r < 0.87 ? 'portrait' : 'square';
};

/**
 * Facebook-style photo grid for `photos` inside `width` pixels.
 * 1 photo keeps its proportions (clamped); 2–4 photos fill a square that is split
 * according to the first photo's shape; 5+ photos use 2 over 3 with "+N".
 */
export function fbGrid(photos: Size[], width: number, gap = 2): Grid {
  const n = photos.length;
  const W = width;
  if (n === 0) return { width: W, height: 0, tiles: [] };
  if (n === 1) {
    const ratio = Math.min(1.25, Math.max(0.52, photos[0].h / photos[0].w));
    const h = Math.round(W * ratio);
    return { width: W, height: h, tiles: [{ index: 0, x: 0, y: 0, w: W, h, more: 0 }] };
  }
  const H = W;
  const half = (W - gap) / 2;
  const tiles: Omit<Tile, 'more'>[] = [];
  const first = shape(photos[0]);

  if (n === 2) {
    const bothWide = photos.every((p) => shape(p) === 'landscape');
    if (bothWide) {
      tiles.push({ index: 0, x: 0, y: 0, w: W, h: half }, { index: 1, x: 0, y: half + gap, w: W, h: half });
    } else {
      tiles.push({ index: 0, x: 0, y: 0, w: half, h: H }, { index: 1, x: half + gap, y: 0, w: half, h: H });
    }
  } else if (n <= 4) {
    const rest = n - 1;
    if (n === 4 && first === 'square') {
      // 2 × 2
      for (let i = 0; i < 4; i++) tiles.push({ index: i, x: (i % 2) * (half + gap), y: Math.floor(i / 2) * (half + gap), w: half, h: half });
    } else if (first === 'portrait') {
      // big photo on the left, the rest stacked on the right
      const bigW = Math.round(W * (n === 3 ? 0.5 : 0.62)) - gap / 2;
      const colW = W - bigW - gap;
      const rowH = (H - gap * (rest - 1)) / rest;
      tiles.push({ index: 0, x: 0, y: 0, w: bigW, h: H });
      for (let i = 0; i < rest; i++) tiles.push({ index: i + 1, x: bigW + gap, y: i * (rowH + gap), w: colW, h: rowH });
    } else {
      // big photo on top, the rest in a row underneath
      const bigH = Math.round(H * (n === 3 ? 0.5 : 0.62)) - gap / 2;
      const rowH = H - bigH - gap;
      const colW = (W - gap * (rest - 1)) / rest;
      tiles.push({ index: 0, x: 0, y: 0, w: W, h: bigH });
      for (let i = 0; i < rest; i++) tiles.push({ index: i + 1, x: i * (colW + gap), y: bigH + gap, w: colW, h: rowH });
    }
  } else {
    // 5+: two on top, three below
    const topH = (H - gap) / 2;
    const third = (W - gap * 2) / 3;
    tiles.push({ index: 0, x: 0, y: 0, w: half, h: topH }, { index: 1, x: half + gap, y: 0, w: half, h: topH });
    for (let i = 0; i < 3; i++) tiles.push({ index: i + 2, x: i * (third + gap), y: topH + gap, w: third, h: H - topH - gap });
  }

  const rounded = tiles.map((t) => {
    const x = Math.round(t.x);
    const y = Math.round(t.y);
    return { ...t, x, y, w: Math.round(t.x + t.w) - x, h: Math.round(t.y + t.h) - y, more: 0 };
  });
  if (n > 5) rounded[rounded.length - 1].more = n - 5;
  return { width: W, height: H, tiles: rounded };
}

// ---------------------------------------------------------------------------
// Text wrapping

export interface Token {
  text: string;
  /** Hashtag, @mention or URL — drawn in the link colour. */
  link: boolean;
}

export type Line = Token[];

const LINK_RE = /^(#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]+|https?:\/\/\S+|www\.\S+)/u;

function graphemes(s: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

/**
 * Wrap `text` into lines no wider than `maxWidth` (as reported by `measure`).
 * Explicit newlines are kept, blank lines are preserved, and a single word that
 * is too long is broken between characters (never inside an emoji).
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): Line[] {
  const lines: Line[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!para.trim()) {
      lines.push([]);
      continue;
    }
    let line: Line = [];
    let width = 0;
    const words = para.split(/(\s+)/).filter((w) => w.length);
    for (const raw of words) {
      const isSpace = /^\s+$/.test(raw);
      const word = isSpace ? ' ' : raw;
      const w = measure(word);
      if (isSpace) {
        if (line.length) {
          line.push({ text: ' ', link: false });
          width += w;
        }
        continue;
      }
      const link = LINK_RE.test(word);
      if (width + w <= maxWidth || !line.length) {
        if (w <= maxWidth) {
          line.push({ text: word, link });
          width += w;
          continue;
        }
      } else {
        // start a new line (drop trailing space)
        while (line.length && line[line.length - 1].text === ' ') line.pop();
        lines.push(line);
        line = [];
        width = 0;
        if (w <= maxWidth) {
          line.push({ text: word, link });
          width = w;
          continue;
        }
      }
      // Word longer than a line: break it into chunks.
      let chunk = '';
      for (const g of graphemes(word)) {
        if (measure(chunk + g) + width > maxWidth && (chunk || line.length)) {
          if (chunk) line.push({ text: chunk, link });
          lines.push(line);
          line = [];
          width = 0;
          chunk = g;
        } else {
          chunk += g;
        }
      }
      if (chunk) {
        line.push({ text: chunk, link });
        width += measure(chunk);
      }
    }
    while (line.length && line[line.length - 1].text === ' ') line.pop();
    lines.push(line);
  }
  // Drop trailing blank lines.
  while (lines.length && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

export const lineText = (l: Line) => l.map((t) => t.text).join('');

/** Facebook only allows coloured backgrounds on short text-only posts. */
export const BACKGROUND_TEXT_LIMIT = 130;

/** Font size Facebook-style background posts use for a given text length (in 500 px card units). */
export function backgroundFontSize(text: string): number {
  const len = [...text].length;
  if (len <= 40) return 32;
  if (len <= 85) return 28;
  if (len <= 130) return 24;
  return 20;
}
