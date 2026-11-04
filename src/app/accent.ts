/** Refined accent palette (deeper, less neon). Old mint-style values saved by earlier builds are mapped over. */
export const ACCENTS = ['#22a67a', '#2f80ed', '#7c6cf0', '#e0527a', '#d9902f', '#64748b'] as const;

const LEGACY: Record<string, string> = {
  '#34d399': ACCENTS[0],
  '#38bdf8': ACCENTS[1],
  '#a78bfa': ACCENTS[2],
  '#f472b6': ACCENTS[3],
  '#f87171': ACCENTS[3],
  '#fbbf24': ACCENTS[4],
};

export function resolveAccent(hex?: string | null): string {
  if (!hex) return ACCENTS[0];
  const h = hex.toLowerCase();
  return LEGACY[h] ?? h;
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Text colour on the accent: white, except on a very pale custom accent where it would vanish. */
export function onAccent(hex: string): string {
  return luminance(hex) > 0.6 ? '#0b1210' : '#ffffff';
}
