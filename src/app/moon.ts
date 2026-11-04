// Moon phase from low-precision lunar and solar longitudes.
// Error is about half a degree of elongation, i.e. roughly an hour of phase.

const SYNODIC = 29.530588853;
const RAD = Math.PI / 180;

export interface MoonPhase {
  /** 0..1 through the lunar cycle (0 new, 0.5 full). */
  fraction: number;
  /** Days since the last new moon. */
  age: number;
  /** Lit share of the disk, 0..1. */
  illumination: number;
  waxing: boolean;
  key: PhaseKey;
}

export type PhaseKey =
  | 'new'
  | 'waxing-crescent'
  | 'first-quarter'
  | 'waxing-gibbous'
  | 'full'
  | 'waning-gibbous'
  | 'last-quarter'
  | 'waning-crescent';

const norm = (deg: number) => ((deg % 360) + 360) % 360;

export function moonPhase(at: Date): MoonPhase {
  const d = at.getTime() / 86400000 - 10957.5; // days since J2000.0
  const L = 218.316 + 13.176396 * d; // moon mean longitude
  const Mm = 134.963 + 13.064993 * d; // moon mean anomaly
  const Ms = 357.529 + 0.98560028 * d; // sun mean anomaly
  const q = 280.459 + 0.98564736 * d; // sun mean longitude
  const D = L - q; // mean elongation
  const moonLon =
    L +
    6.289 * Math.sin(Mm * RAD) +
    1.274 * Math.sin((2 * D - Mm) * RAD) +
    0.658 * Math.sin(2 * D * RAD) -
    0.186 * Math.sin(Ms * RAD) +
    0.214 * Math.sin(2 * Mm * RAD);
  const sunLon = q + 1.915 * Math.sin(Ms * RAD) + 0.02 * Math.sin(2 * Ms * RAD);
  const elong = norm(moonLon - sunLon);
  const fraction = elong / 360;
  const illumination = (1 - Math.cos(elong * RAD)) / 2;
  return {
    fraction,
    age: fraction * SYNODIC,
    illumination,
    waxing: fraction < 0.5,
    key: phaseKey(fraction),
  };
}

function phaseKey(f: number): PhaseKey {
  // Named phases get about a day either side; the rest is between them.
  const w = 1 / SYNODIC;
  if (f < w || f > 1 - w) return 'new';
  if (Math.abs(f - 0.25) < w) return 'first-quarter';
  if (Math.abs(f - 0.5) < w) return 'full';
  if (Math.abs(f - 0.75) < w) return 'last-quarter';
  if (f < 0.25) return 'waxing-crescent';
  if (f < 0.5) return 'waxing-gibbous';
  if (f < 0.75) return 'waning-gibbous';
  return 'waning-crescent';
}

export const PHASE_NAME: Record<PhaseKey, { en: string; bn: string }> = {
  new: { en: 'New moon', bn: 'অমাবস্যা' },
  'waxing-crescent': { en: 'Waxing crescent', bn: 'বাড়ন্ত বাঁকা চাঁদ' },
  'first-quarter': { en: 'First quarter (half)', bn: 'প্রথম অর্ধচন্দ্র' },
  'waxing-gibbous': { en: 'Waxing gibbous', bn: 'বাড়ন্ত চাঁদ' },
  full: { en: 'Full moon', bn: 'পূর্ণিমা' },
  'waning-gibbous': { en: 'Waning gibbous', bn: 'ক্ষয়িষ্ণু চাঁদ' },
  'last-quarter': { en: 'Last quarter (half)', bn: 'শেষ অর্ধচন্দ্র' },
  'waning-crescent': { en: 'Waning crescent', bn: 'ক্ষয়িষ্ণু বাঁকা চাঁদ' },
};

/** Phase as seen in the evening of a calendar date (yyyy-mm-dd, local). */
export function eveningPhase(ymd: string): MoonPhase {
  const [y, m, d] = ymd.split('-').map(Number);
  return moonPhase(new Date(y, m - 1, d, 19, 0));
}

/** Plain-language visibility note for the evening of a date. */
export function visibility(p: MoonPhase): string {
  const h = p.age * 24;
  if (p.waxing && h < 15) return 'Not visible — moon too close to the sun';
  if (p.waxing && h < 40) return 'Thin crescent (hilal) may be seen low in the west just after sunset';
  if (!p.waxing && p.age > 28) return 'Not visible — new moon is close';
  if (p.waxing && p.fraction < 0.25) return 'Visible in the west in the evening, sets a few hours after sunset';
  if (p.key === 'full') return 'Rises at sunset, visible all night';
  if (p.waxing) return 'Visible from afternoon, high in the evening sky';
  if (p.fraction < 0.75) return 'Rises a few hours after sunset, visible late night';
  return 'Rises after midnight, visible before Fajr in the east';
}

/**
 * SVG path of the lit part of a moon of radius r centred at 0,0.
 * Northern-hemisphere view: waxing is lit on the right.
 */
export function litPath(p: MoonPhase, r: number): string {
  const f = p.fraction;
  if (p.illumination < 0.01) return '';
  if (p.illumination > 0.99) return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  const rx = Math.abs(Math.cos(2 * Math.PI * f)) * r;
  const gibbous = p.illumination > 0.5;
  const t = (n: number) => n.toFixed(2);
  if (p.waxing) {
    // Right half, then back up through the terminator.
    return `M 0 ${t(-r)} A ${t(r)} ${t(r)} 0 0 1 0 ${t(r)} A ${t(rx)} ${t(r)} 0 0 ${gibbous ? 1 : 0} 0 ${t(-r)} Z`;
  }
  return `M 0 ${t(-r)} A ${t(r)} ${t(r)} 0 0 0 0 ${t(r)} A ${t(rx)} ${t(r)} 0 0 ${gibbous ? 0 : 1} 0 ${t(-r)} Z`;
}
