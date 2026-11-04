/**
 * Draws a Facebook-style post card (or a square text graphic) onto a canvas.
 * Canvas is used for both the live preview and the export so what you see is
 * exactly what is saved, including system fonts and colour emoji.
 */
import { backgroundFontSize, fbGrid, lineText, wrapText, type Line } from './layout';

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

export interface Background {
  id: string;
  label: string;
  /** One colour, or two for a diagonal gradient. */
  colors: [string] | [string, string];
  text: string;
}

export const BACKGROUNDS: Background[] = [
  { id: 'purple', label: 'Purple', colors: ['#8a3ffc', '#e040fb'], text: '#ffffff' },
  { id: 'sunset', label: 'Sunset', colors: ['#ff5f6d', '#ffc371'], text: '#ffffff' },
  { id: 'ocean', label: 'Ocean', colors: ['#2193b0', '#6dd5ed'], text: '#ffffff' },
  { id: 'blue', label: 'Blue', colors: ['#1877f2'], text: '#ffffff' },
  { id: 'red', label: 'Red', colors: ['#f02849'], text: '#ffffff' },
  { id: 'green', label: 'Green', colors: ['#11998e', '#38ef7d'], text: '#ffffff' },
  { id: 'night', label: 'Night', colors: ['#0f2027', '#2c5364'], text: '#ffffff' },
  { id: 'black', label: 'Black', colors: ['#1c1e21'], text: '#ffffff' },
  { id: 'peach', label: 'Peach', colors: ['#ffecd2', '#fcb69f'], text: '#1c1e21' },
  { id: 'mint', label: 'Mint', colors: ['#d4fc79', '#96e6a1'], text: '#1c1e21' },
  { id: 'lavender', label: 'Lavender', colors: ['#e0c3fc', '#8ec5fc'], text: '#1c1e21' },
  { id: 'paper', label: 'Paper', colors: ['#f0f2f5'], text: '#1c1e21' },
];

export interface CardModel {
  theme: 'light' | 'dark';
  name: string;
  /** Avatar image (already loaded) or null for initials. */
  avatar: HTMLImageElement | null;
  avatarColor: string;
  time: string;
  audience: 'public' | 'friends' | 'only-me';
  text: string;
  mode: 'photos' | 'background';
  background: Background;
  photos: { img: HTMLImageElement; w: number; h: number }[];
  collapse: boolean;
  engagement: { show: boolean; likes: number; comments: number; shares: number };
}

const THEMES = {
  light: { page: '#f0f2f5', card: '#ffffff', text: '#050505', sub: '#65676b', line: '#ced0d4', link: '#0064d1', hover: '#f2f2f2', like: '#1877f2' },
  dark: { page: '#18191a', card: '#242526', text: '#e4e6eb', sub: '#b0b3b8', line: '#3e4042', link: '#4599ff', hover: '#3a3b3c', like: '#2d88ff' },
};

/** Card width in CSS pixels (Facebook's feed column). */
export const CARD_W = 500;
const PAD = 16;

// 24×24 icon paths for the action bar.
const ICON_LIKE = 'M7 10v11M2 11a1 1 0 0 1 1-1h4v11H3a1 1 0 0 1-1-1v-9Zm5-1 4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.7 21H7';
const ICON_COMMENT = 'M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2-5.3A8.4 8.4 0 1 1 21 11.5Z';
const ICON_SHARE = 'M14 4l7 7-7 7v-4c-5 0-8.5 1.6-11 5 1-5 4-10 11-11V4Z';
const ICON_GLOBE = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20';
const ICON_FRIENDS = 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7';
const ICON_LOCK = 'M5 11h14v10H5V11Zm3 0V7a4 4 0 0 1 8 0v4';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function icon(ctx: CanvasRenderingContext2D, d: string, x: number, y: number, size: number, color: string, width = 2) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(d));
  ctx.restore();
}

/** Draw an image covering a rectangle (centre crop). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

function fillBackground(ctx: CanvasRenderingContext2D, bg: Background, x: number, y: number, w: number, h: number) {
  if (bg.colors.length === 1) {
    ctx.fillStyle = bg.colors[0];
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, bg.colors[0]);
    g.addColorStop(1, bg.colors[1]);
    ctx.fillStyle = g;
  }
  ctx.fillRect(x, y, w, h);
}

function drawLines(ctx: CanvasRenderingContext2D, lines: Line[], x: number, y: number, lineH: number, color: string, linkColor: string, align: 'left' | 'center', maxW: number) {
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const total = ctx.measureText(lineText(line)).width;
    let cx = align === 'center' ? x + (maxW - total) / 2 : x;
    const cy = y + i * lineH + lineH / 2;
    for (const t of line) {
      ctx.fillStyle = t.link ? linkColor : color;
      ctx.fillText(t.text, cx, cy);
      cx += ctx.measureText(t.text).width;
    }
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n));

/** True when the post qualifies for a coloured background on Facebook. */
export const usesBackground = (m: CardModel) => m.mode === 'background' && m.text.trim().length > 0;

/**
 * Render the whole post card at `scale` (2 = retina) onto `canvas`, resizing it.
 * Returns the card size in CSS pixels.
 */
export function renderCard(canvas: HTMLCanvasElement, m: CardModel, scale: number): { width: number; height: number } {
  const t = THEMES[m.theme];
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const W = CARD_W;
  const innerW = W - PAD * 2;
  const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT}`;

  // ---- Layout pass ----
  const bg = usesBackground(m);
  let textLines: Line[] = [];
  let truncated = false;
  let bgLines: Line[] = [];
  let bgFont = 0;
  let bgH = 0;
  if (bg) {
    bgFont = backgroundFontSize(m.text);
    ctx.font = font(bgFont, 700);
    bgLines = wrapText(m.text, W - 80, (s) => ctx.measureText(s).width);
    bgH = Math.max(Math.round(W * 0.75), bgLines.length * bgFont * 1.25 + 80);
  } else if (m.text.trim()) {
    const large = [...m.text.trim()].length <= 85 && !m.photos.length;
    ctx.font = font(large ? 24 : 15);
    textLines = wrapText(m.text, innerW, (s) => ctx.measureText(s).width);
    const limit = m.photos.length ? 3 : 5;
    if (m.collapse && textLines.length > limit + 1) {
      textLines = textLines.slice(0, limit);
      truncated = true;
    }
  }
  const large = !bg && [...m.text.trim()].length <= 85 && !m.photos.length;
  const textSize = large ? 24 : 15;
  const textLH = large ? 30 : 20;
  const grid = !bg && m.photos.length ? fbGrid(m.photos.map((p) => ({ w: p.w, h: p.h })), W) : null;

  const headerH = 12 + 40 + 12;
  let H = headerH;
  const textY = H;
  if (textLines.length) H += textLines.length * textLH + 4 + (grid ? 12 : 16);
  const bgY = H;
  if (bg) H += bgH;
  const gridY = H;
  if (grid) H += grid.height;
  const engageY = H;
  if (m.engagement.show) H += 42;
  const actionsY = H;
  H += 44 + 4;

  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // ---- Card ----
  ctx.fillStyle = t.card;
  roundRect(ctx, 0, 0, W, H, 8);
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 8);
  ctx.clip();

  // Header
  const ax = PAD;
  const ay = 12;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + 20, ay + 20, 20, 0, Math.PI * 2);
  ctx.clip();
  if (m.avatar) {
    drawCover(ctx, m.avatar, ax, ay, 40, 40);
  } else {
    ctx.fillStyle = m.avatarColor;
    ctx.fillRect(ax, ay, 40, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(16, 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(m.name), ax + 20, ay + 21);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.text;
  ctx.font = font(15, 600);
  ctx.fillText(m.name.trim() || 'Your Name', ax + 50, ay + 17);
  ctx.fillStyle = t.sub;
  ctx.font = font(13);
  const timeLabel = `${m.time.trim() || 'Just now'} · `;
  ctx.fillText(timeLabel, ax + 50, ay + 35);
  const tw = ctx.measureText(timeLabel).width;
  icon(ctx, m.audience === 'public' ? ICON_GLOBE : m.audience === 'friends' ? ICON_FRIENDS : ICON_LOCK, ax + 50 + tw, ay + 24.5, 12, t.sub, 2.2);
  // "..." menu
  ctx.fillStyle = t.sub;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(W - PAD - 30 + i * 6, ay + 20, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  icon(ctx, 'M6 6l12 12M18 6 6 18', W - PAD - 14, ay + 13, 14, t.sub, 2.2);

  // Text
  if (textLines.length) {
    ctx.font = font(textSize);
    drawLines(ctx, textLines, PAD, textY, textLH, t.text, t.link, 'left', innerW);
    if (truncated) {
      const last = textLines[textLines.length - 1];
      const lastW = ctx.measureText(lineText(last)).width;
      const more = '… See more';
      ctx.font = font(textSize, 600);
      const mw = ctx.measureText(more).width;
      const y = textY + (textLines.length - 1) * textLH + textLH / 2;
      const x = Math.min(PAD + lastW + 2, W - PAD - mw);
      if (x < PAD + lastW) {
        ctx.fillStyle = t.card;
        ctx.fillRect(x - 2, y - textLH / 2, W - x, textLH);
      }
      ctx.fillStyle = t.text;
      ctx.fillText(more, x, y);
    }
  }

  // Coloured background post
  if (bg) {
    fillBackground(ctx, m.background, 0, bgY, W, bgH);
    ctx.font = font(bgFont, 700);
    const lh = bgFont * 1.25;
    const blockH = bgLines.length * lh;
    drawLines(ctx, bgLines, 40, bgY + (bgH - blockH) / 2, lh, m.background.text, m.background.text, 'center', W - 80);
  }

  // Photos
  if (grid) {
    ctx.fillStyle = t.card;
    ctx.fillRect(0, gridY, W, grid.height);
    for (const tile of grid.tiles) {
      const p = m.photos[tile.index];
      if (!p) continue;
      drawCover(ctx, p.img, tile.x, gridY + tile.y, tile.w, tile.h);
      if (tile.more > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(tile.x, gridY + tile.y, tile.w, tile.h);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(30, 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${tile.more}`, tile.x + tile.w / 2, gridY + tile.y + tile.h / 2);
        ctx.textAlign = 'left';
      }
    }
  }

  // Engagement summary
  if (m.engagement.show) {
    const y = engageY + 21;
    const { likes, comments, shares } = m.engagement;
    let x = PAD;
    if (likes > 0) {
      // like (blue) + love (red) bubbles
      ctx.fillStyle = '#f33e58';
      ctx.beginPath();
      ctx.arc(x + 9 + 14, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.like;
      ctx.beginPath();
      ctx.arc(x + 9, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = t.card;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.translate(x + 9 + 14, y + 0.5);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.bezierCurveTo(-6, 0, -4.5, -5, 0, -2.5);
      ctx.bezierCurveTo(4.5, -5, 6, 0, 0, 4);
      ctx.fill();
      ctx.restore();
      icon(ctx, ICON_LIKE, x + 3.5, y - 5.5, 11, '#ffffff', 2.6);
      x += 9 + 14 + 9 + 6;
      ctx.fillStyle = t.sub;
      ctx.font = font(15);
      ctx.textBaseline = 'middle';
      ctx.fillText(compact(likes), x, y);
    }
    const right = [comments > 0 ? `${compact(comments)} comment${comments === 1 ? '' : 's'}` : '', shares > 0 ? `${compact(shares)} share${shares === 1 ? '' : 's'}` : ''].filter(Boolean).join('   ');
    if (right) {
      ctx.fillStyle = t.sub;
      ctx.font = font(15);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillText(right, W - PAD, y);
      ctx.textAlign = 'left';
    }
  }

  // Action bar
  ctx.fillStyle = t.line;
  ctx.fillRect(PAD, actionsY, W - PAD * 2, 1);
  const actions: [string, string][] = [
    [ICON_LIKE, 'Like'],
    [ICON_COMMENT, 'Comment'],
    [ICON_SHARE, 'Share'],
  ];
  const colW = (W - PAD * 2) / 3;
  ctx.font = font(15, 600);
  ctx.textBaseline = 'middle';
  actions.forEach(([d, label], i) => {
    const lw = ctx.measureText(label).width;
    const cx = PAD + colW * i + colW / 2;
    const startX = cx - (20 + 6 + lw) / 2;
    const cy = actionsY + 1 + 22;
    icon(ctx, d, startX, cy - 10, 20, t.sub, 1.9);
    ctx.fillStyle = t.sub;
    ctx.fillText(label, startX + 26, cy + 1);
  });

  ctx.restore();
  return { width: W, height: H };
}

/**
 * Render the text of a background post as a square image that can be uploaded
 * to Facebook, Instagram or a story as a normal photo.
 */
export function renderTextGraphic(canvas: HTMLCanvasElement, text: string, bg: Background, size: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  canvas.width = size;
  canvas.height = size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  fillBackground(ctx, bg, 0, 0, size, size);
  const k = size / CARD_W;
  let fontSize = backgroundFontSize(text) * k * 1.15;
  const maxW = size * 0.82;
  let lines: Line[] = [];
  // Shrink until the text fits vertically.
  for (let i = 0; i < 12; i++) {
    ctx.font = `700 ${fontSize}px ${FONT}`;
    lines = wrapText(text, maxW, (s) => ctx.measureText(s).width);
    if (lines.length * fontSize * 1.25 <= size * 0.82) break;
    fontSize *= 0.88;
  }
  const lh = fontSize * 1.25;
  drawLines(ctx, lines, (size - maxW) / 2, (size - lines.length * lh) / 2, lh, bg.text, bg.text, 'center', maxW);
}
