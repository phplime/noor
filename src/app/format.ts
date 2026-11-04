/** "11:48 AM" → { t: "11:48", p: "AM" } (24-hour strings have no period). */
export function splitTime(s: string): { t: string; p: string } {
  const m = /^(.*?)\s*([AP]M)$/i.exec(s.trim());
  return m ? { t: m[1], p: m[2].toUpperCase() } : { t: s.trim(), p: '' };
}
