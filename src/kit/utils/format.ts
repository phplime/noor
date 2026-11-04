export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const formatDims = (w: number | null | undefined, h: number | null | undefined): string =>
  w && h ? `${w} × ${h}` : '—';

/** Signed change of an actual measured size, e.g. "−42%" or "+3%". */
export function sizeChange(before: number, after: number): string {
  if (!before) return '—';
  const pct = ((after - before) / before) * 100;
  const rounded = Math.abs(pct) < 1 ? pct.toFixed(1) : Math.round(pct).toString();
  if (pct < 0) return `−${rounded.replace('-', '')}%`;
  return `+${rounded}%`;
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '/';
}

export function stem(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Shorten long paths for display: ~/…/folder/file.png */
export function shortPath(path: string, keep = 2): string {
  const home = path.match(/^\/Users\/[^/]+/);
  let p = home ? `~${path.slice(home[0].length)}` : path;
  const parts = p.split('/');
  if (parts.length > keep + 2) p = [parts[0], '…', ...parts.slice(-keep)].join('/');
  return p;
}

/** Positive integer within [min, max], or null when invalid. */
export function parsePositiveInt(v: string, min = 1, max = 100000): number | null {
  if (!/^\s*\d+\s*$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/** Greatest common divisor, for showing simplified ratios (1200×628 → 300:157). */
export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function ratioLabel(w: number, h: number): string {
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}
