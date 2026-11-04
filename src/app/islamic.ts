/** Hijri date, Qibla bearing and a time-of-day greeting. All offline. */

export function hijriDate(d = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' })
      .format(d)
      .replace(/\s?AH$/, ' AH');
  } catch {
    return '';
  }
}

export function gregorianLong(d = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

const KAABA = { lat: 21.4225, lon: 39.8262 };

/** Initial great-circle bearing from a point to the Kaaba, degrees from true north. */
export function qiblaBearing(lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const φ1 = lat * rad;
  const φ2 = KAABA.lat * rad;
  const Δλ = (KAABA.lon - lon) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Great-circle distance to the Kaaba in km. */
export function kaabaDistanceKm(lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const dφ = (KAABA.lat - lat) * rad;
  const dλ = (KAABA.lon - lon) * rad;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(lat * rad) * Math.cos(KAABA.lat * rad) * Math.sin(dλ / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function compassPoint(deg: number): string {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round(deg / 22.5) % 16];
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Peaceful night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Peaceful night';
}
