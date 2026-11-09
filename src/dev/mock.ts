/**
 * Browser preview with fake data: `npm run dev:mock`, then open http://localhost:1440
 * in Safari/Chrome (use the responsive/iPhone view). Only loaded when VITE_MOCK=1;
 * never part of the app build.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { DEFAULT_SETTINGS } from '../kit/types/settings';
import { playSound } from '../app/sound';
import { distanceM, type Place } from '../app/places';
import type { CalendarSettings, Profile, RamadanSettings, RamadanStatus, SpecialDay } from '../app/calendar';
import * as mc from './mockcal';
import type { CycleData, CycleDay, CycleStatus } from '../app/cycle';

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (d: Date, hh: number, mm: number) => {
  const x = new Date(d);
  x.setHours(hh, mm, 0, 0);
  return x.toISOString();
};

const PRAYERS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
const TIMES: [number, number][] = [
  [4, 56],
  [6, 9],
  [11, 48],
  [15, 41],
  [17, 22],
  [18, 39],
];

// ----- salah tracker (preview) -----
const SP = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const salahMarks = new Map<string, string>();
const qaza = { fajr: 3, dhuhr: 0, asr: 1, maghrib: 0, isha: 2, witr: 2, madeUp: 4 };
(() => {
  const base = new Date();
  for (let back = 1; back <= 16; back++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - back);
    const key = ymd(d);
    SP.forEach((p, i) => {
      const r = (back * 7 + i * 3) % 11;
      const st = back > 12 && i === 0 ? 'missed' : r < 3 ? 'jamaat' : r < 9 ? 'onTime' : 'late';
      salahMarks.set(`${key}|${p}`, st);
    });
  }
  const t = ymd(base);
  salahMarks.set(`${t}|fajr`, 'jamaat');
})();
function salahStats() {
  const today = new Date();
  const dayStatus = (d: Date) => {
    const k = ymd(d);
    let all = true;
    for (const p of SP) {
      const s = salahMarks.get(`${k}|${p}`);
      if (s === 'missed') return false;
      if (!s) all = false;
    }
    return all ? true : null;
  };
  let streak = 0;
  const d = new Date(today);
  const t0 = dayStatus(d);
  if (t0 === false) return { streak: 0, bestStreak: 12, weekPrayed: 0, weekJamaat: 0, weekMissed: 1, onTimePct: 0 };
  if (t0 === null) d.setDate(d.getDate() - 1);
  while (dayStatus(d) === true) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  let wp = 0, wj = 0, wm = 0, good = 0, marked = 0;
  for (const [k, s] of salahMarks) {
    const [ds] = k.split('|');
    const age = (Date.parse(ymd(today)) - Date.parse(ds)) / 86_400_000;
    if (age < 7) {
      if (s === 'missed') wm++;
      else wp++;
      if (s === 'jamaat') wj++;
    }
    if (age < 30) {
      marked++;
      if (s === 'jamaat' || s === 'onTime') good++;
    }
  }
  return { streak, bestStreak: Math.max(streak, 12), weekPrayed: wp, weekJamaat: wj, weekMissed: wm, onTimePct: marked ? Math.round((good * 100) / marked) : 0 };
}

// ----- fitness (preview) -----
const fitnessData = (() => {
  const t = new Date();
  const day = (back: number) => ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - back));
  const weights = [74.2, 73.8, 73.9, 73.4, 73.1, 72.9, 72.6, 72.8, 72.3, 72.0, 71.8, 71.6].map((kg, i) => ({ date: day(77 - i * 7), kg }));
  const steps = [6200, 9400, 8800, 4300, 10200, 7600, 5230].map((n, i) => ({ date: day(6 - i), steps: n, source: 'motion' }));
  return { profile: { heightCm: 170.2, goalKg: 68, stepGoal: 8000, asianBmi: true, weighReminder: true, weighDay: 5, weighTime: '08:00', birthYear: 1991, sex: 'male' }, weights, steps };
})();
function fitnessOverview() {
  const d = fitnessData;
  const today = ymd(new Date());
  const st = (k: string) => d.steps.find((x) => x.date === k)?.steps ?? 0;
  const last = d.weights[d.weights.length - 1];
  const h = d.profile.heightCm / 100;
  const bmi = last ? Math.round((last.kg / (h * h)) * 10) / 10 : null;
  const band = bmi == null ? null : bmi < 18.5 ? 'under' : bmi < 23 ? 'healthy' : bmi < 27.5 ? 'over' : 'obese';
  const prev = (n: number) => d.weights[Math.max(0, d.weights.length - 1 - n)];
  const week = Array.from({ length: 7 }, (_, i) => st(ymd(new Date(Date.now() - i * 86_400_000))));
  return {
    data: d,
    summary: {
      today,
      stepsToday: st(today),
      stepGoal: d.profile.stepGoal,
      kmToday: Math.round((st(today) * d.profile.heightCm * 0.415) / 10000) / 10,
      kcalToday: Math.round((st(today) * 0.04 * (last?.kg ?? 65)) / 70),
      stepsWeekAvg: Math.round(week.reduce((x, y) => x + y, 0) / 7),
      stepStreak: 0,
      weight: last?.kg ?? null,
      weightDate: last?.date ?? null,
      change7d: last ? Math.round((last.kg - prev(1).kg) * 10) / 10 : null,
      change30d: last ? Math.round((last.kg - prev(4).kg) * 10) / 10 : null,
      bmi,
      bmiBand: band,
      healthyMinKg: Math.round(18.5 * h * h * 10) / 10,
      healthyMaxKg: Math.round(22.9 * h * h * 10) / 10,
      toGoalKg: last && d.profile.goalKg ? Math.round((last.kg - d.profile.goalKg) * 10) / 10 : null,
    },
  };
}

/** Hand-set prayer times in the preview: fixed "HH:MM" or minute offsets. */
const adjust: Record<string, { fixed?: string; offset?: number }> = { dhuhr: { fixed: '13:15' } };
const adj0 = (p: string) => adjust[p] ?? {};

function schedule(d: Date) {
  return {
    date: ymd(d),
    locationId: 'dhaka',
    locationName: 'Dhaka',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    method: 'karachi',
    asr: 'hanafi',
    entries: PRAYERS.map((p, i) => {
      const calc = at(d, TIMES[i][0], TIMES[i][1]);
      const adj = adj0(p);
      let time = calc;
      let jamaat: string | null = null;
      if (adj.fixed) {
        // A hand-set time is the mosque's jamaat; the prayer still starts at the calculated time.
        const [h, m] = adj.fixed.split(':').map(Number);
        jamaat = at(d, h, m);
      } else if (adj.offset) {
        time = new Date(Date.parse(calc) + adj.offset * 60_000).toISOString();
      }
      return {
        prayer: p,
        time,
        calculatedTime: calc,
        offsetMinutes: adj.fixed ? 0 : adj.offset ?? 0,
        source: 'calculated',
        highLatitudeAdjusted: false,
        jamaat,
      };
    }),
  };
}

const notifications = {
  masterEnabled: true,
  jamaatAlerts: true,
  jamaatBeforeMinutes: 10,
  defaultSound: 'noor_dawn',
  graceMinutes: 10,
  prayers: PRAYERS.map((p) => ({
    prayer: p,
    enabled: p !== 'sunrise',
    reminders: [
      { id: `${p}-b`, prayer: p, offsetMinutes: -10, enabled: true, title: null, message: null, sound: null },
      { id: `${p}-a`, prayer: p, offsetMinutes: 0, enabled: true, title: null, message: null, sound: null },
    ],
  })),
};

const location = {
  id: 'dhaka',
  name: 'Dhaka',
  region: 'Dhaka',
  country: 'Bangladesh',
  latitude: 23.8103,
  longitude: 90.4125,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  elevation: 0,
  source: 'search',
};

// Preview only: pretend the phone is ~300 m from the mosque so distances and "inside" can be seen.
const PREVIEW_POS = { latitude: 23.7325, longitude: 90.4119 };
const fakeGeo = {
  getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { ...PREVIEW_POS, accuracy: 15 }, timestamp: Date.now() }),
  watchPosition: (ok: (p: unknown) => void) => {
    ok({ coords: { ...PREVIEW_POS, accuracy: 15 }, timestamp: Date.now() });
    return 1;
  },
  clearWatch: () => undefined,
};
Object.defineProperty(navigator, 'geolocation', { value: fakeGeo, configurable: true });

const state = {
  places: [
    { id: 'p1', name: 'Baitul Mukarram Masjid', latitude: 23.7298, longitude: 90.4119, radiusM: 500, automated: false, createdAt: 1 },
    { id: 'p2', name: 'Office', latitude: 23.7808, longitude: 90.4167, radiusM: 300, automated: true, createdAt: 2 },
  ] as Place[],
  water: [
    { id: 1, ml: 250, at: Date.now() - 4 * 3600_000 },
    { id: 2, ml: 250, at: Date.now() - 2 * 3600_000 },
    { id: 3, ml: 330, at: Date.now() - 3600_000 },
  ],
  settings: {
    modules: [],
    defaultModule: null,
    expandOnHover: true,
    compactMusic: true,
    clipboardHistory: false,
    clipboardMaxItems: 50,
    musicLyrics: false,
    use24Hour: false,
    water: { goalMl: 2000, glassMl: 250, reminders: true, mode: 'smart', remindEveryMin: 60, times: ['09:00', '12:00', '15:00'], minGapMin: 45, start: '08:00', end: '22:00' },
    iphoneFolder: null,
    iphoneToShelf: false,
    lastModule: null,
  },
  todos: [
    { id: 't1', title: 'Call Ammu after Asr', done: false, createdAt: 1, doneAt: null, position: 1 },
    { id: 't2', title: 'Pay electricity bill', done: false, createdAt: 2, doneAt: null, position: 2 },
    { id: 't3', title: 'Buy dates for iftar', done: true, createdAt: 3, doneAt: 4, position: 3 },
  ],
  timer: { label: 'Tea', durationMs: 8 * 60_000, endsAt: Date.now() + 5 * 60_000 + 12_000, pausedRemaining: null, notified: false } as Record<string, unknown>,
  stopwatch: { startedAt: null, accumulatedMs: 0, laps: [] as number[] },
  reminders: [
    { id: 'r1', title: 'Read Surah Al-Kahf', note: 'Jumu’ah', at: `${ymd(day(1))}T10:00`, repeat: 'weekly', enabled: true, sound: 'noor_bell', color: '#9b6bff', createdAt: 1 },
    { id: 'r2', title: 'Take vitamins', note: '', at: `${ymd(day(0))}T21:00`, repeat: 'daily', enabled: true, sound: 'noor_chime', color: '#34d399', createdAt: 2 },
    { id: 'r3', title: 'Renew passport', note: 'Bring photos', at: `${ymd(day(9))}T11:30`, repeat: 'never', enabled: true, sound: 'noor_glass', color: '#ff9f43', createdAt: 3 },
  ],
};

function snapshot() {
  return {
    settings: {
      calculation: {
        method: 'karachi',
        asr: 'hanafi',
        highLatitude: 'middleOfNight',
        customFajrAngle: 18,
        customIshaAngle: 18,
        customIshaMinutes: null,
        offsets: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
        mode: 'calculated',
      },
      manual: {},
      notifications,
      display: {
        showNextInCompact: true,
        showCountdown: true,
        highlightUpcoming: true,
        showSunrise: true,
        prePrayerCountdownMinutes: 15,
        use24Hour: false,
        cardStyle: 'comfortable',
        accent: '#34d399',
        expandOnNotificationClick: true,
      },
      locationMode: 'saved',
      activeLocationId: 'dhaka',
    },
    locations: [location],
    activeLocation: location,
    today: schedule(day(0)),
    tomorrow: schedule(day(1)),
    next: null,
    methods: [
      { id: 'karachi', name: 'University of Islamic Sciences, Karachi', description: 'Fajr 18°, Isha 18°' },
      { id: 'muslimWorldLeague', name: 'Muslim World League', description: 'Fajr 18°, Isha 17°' },
    ],
    now: new Date().toISOString(),
  };
}

function waterToday() {
  const total = state.water.reduce((n, e) => n + e.ml, 0);
  const week: [string, number][] = [-6, -5, -4, -3, -2, -1, 0].map((o, i) => [ymd(day(o)), o === 0 ? total : [1800, 2200, 1500, 2050, 900, 2400][i]]);
  return { date: ymd(day(0)), totalMl: total, goalMl: state.settings.water.goalMl, entries: state.water, week };
}

function upcoming() {
  const now = Date.now();
  const out: { kind: string; route: string; fireAt: string; title: string; body: string; sound: string }[] = [];
  for (const d of [day(0), day(1)]) {
    PRAYERS.forEach((p, i) => {
      if (p === 'sunrise') return;
      const t = new Date(at(d, TIMES[i][0], TIMES[i][1])).getTime();
      const name = p[0].toUpperCase() + p.slice(1);
      out.push({ kind: 'prayer', route: `prayer:${p}`, fireAt: new Date(t - 600_000).toISOString(), title: `Prayer Reminder — ${name}`, body: `${name} prayer is in 10 minutes.`, sound: 'noor_dawn' });
      out.push({ kind: 'prayer', route: `prayer:${p}`, fireAt: new Date(t).toISOString(), title: `Prayer Time — ${name}`, body: `It is time for ${name} prayer.`, sound: 'noor_dawn' });
    });
  }
  out.push({ kind: 'timer', route: 'timer', fireAt: new Date(state.timer.endsAt as number).toISOString(), title: 'Tea — done ⏱', body: 'Your timer has finished.', sound: 'noor_timer' });
  out.push({ kind: 'water', route: 'water', fireAt: new Date(now + 40 * 60_000).toISOString(), title: 'Time to drink water 💧', body: 'Have a glass (250 ml).', sound: 'noor_pop' });
  out.push({ kind: 'reminder', route: 'reminder:r2', fireAt: new Date(`${ymd(day(0))}T21:00`).toISOString(), title: 'Take vitamins', body: 'Reminder', sound: 'noor_chime' });
  return out.filter((n) => Date.parse(n.fireAt) > now).sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt));
}


// ----- Studio: a generated sample photo so the tools can be tried in the browser -----
let samplePhoto = '';
function sample(): string {
  if (samplePhoto) return samplePhoto;
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 1067;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 1067);
  sky.addColorStop(0, '#1d3b6e');
  sky.addColorStop(0.55, '#f2a65a');
  sky.addColorStop(1, '#3c2a4d');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1600, 1067);
  g.fillStyle = '#ffe2a8';
  g.beginPath();
  g.arc(1080, 560, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#20193a';
  g.beginPath();
  g.moveTo(0, 820);
  g.quadraticCurveTo(400, 640, 800, 800);
  g.quadraticCurveTo(1200, 960, 1600, 760);
  g.lineTo(1600, 1067);
  g.lineTo(0, 1067);
  g.fill();
  samplePhoto = c.toDataURL('image/jpeg', 0.85);
  return samplePhoto;
}
const SAMPLE_FILE = { path: '/mock/Sunset.jpg', name: 'Sunset.jpg', relDir: null, size: 482_133, width: 1600, height: 1067, format: 'jpeg' };
const plan = { sourceW: 1600, sourceH: 1067, outputW: 1600, outputH: 1067, resize: null, cropped: false, warnings: [] };

const changed = (m: string) => void emit('widgets://changed', m);

// ----- cycle tracker (preview only: a simplified twin of cycle.rs) -----
const cycleState: { data: CycleData } = {
  data: {
    settings: { name: 'Ayesha', cycleLen: 28, periodLen: 5, lutealLen: 14, remindPeriod: true, remindDaysBefore: 2, remindFertile: false, remindTime: '09:00', discreet: true },
    periods: [-96, -67, -38, -9].map((o) => ({ start: ymd(day(o)), end: ymd(day(o + 4)) })),
    logs: [{ date: ymd(day(-8)), flow: 3, symptoms: ['Cramps', 'Tired'], mood: '😴 Tired', note: '' }],
  },
};
function cycleStatusMock(): CycleStatus {
  const d = cycleState.data;
  const starts = d.periods.map((p) => p.start).sort();
  const lens = starts.slice(1).map((s2, i) => mc.jdnOfStr(s2) - mc.jdnOfStr(starts[i])).filter((x) => x >= 15 && x <= 60);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : d.settings.cycleLen;
  const len = Math.round(avg);
  const last = starts[starts.length - 1];
  const today = todayStr();
  if (!last) return { hasData: false, cyclesLogged: 0, avgCycle: avg, avgPeriod: 5, shortest: null, longest: null, regularity: 'unknown', history: [], lastStart: null, cycleDay: null, phase: 'none', nextStart: null, nextWindow: null, daysUntilNext: null, lateDays: 0, ovulation: null, fertileStart: null, fertileEnd: null, calendarFertileDays: null, calendarNote: 'Log at least 6 cycles to see lower-chance days (0 so far).', insights: ['Log the first day of the last period to start predictions.'], days: [] };
  const next = mc.addDays(last, len);
  const ovu = mc.addDays(next, -14);
  const fs = mc.addDays(ovu, -5);
  const fe = mc.addDays(ovu, 1);
  const cd = mc.jdnOfStr(today) - mc.jdnOfStr(last) + 1;
  const inPeriod = d.periods.some((p) => today >= p.start && today <= (p.end ?? mc.addDays(p.start, 4)));
  const phase = inPeriod ? 'period' : today >= next ? 'late' : today === ovu ? 'ovulation' : today >= fs && today <= fe ? 'fertile' : today < ovu ? 'follicular' : 'luteal';
  const days: CycleDay[] = [];
  for (let i = -70; i <= 130; i++) {
    const date = mc.addDays(today, i);
    const base = [...starts].reverse().find((s2) => s2 <= date);
    if (!base) { days.push({ date, kind: 'other', cycleDay: null, logged: false }); continue; }
    let st = base;
    let predicted = false;
    if (base === last && mc.jdnOfStr(date) >= mc.jdnOfStr(last) + len) { const k = Math.floor((mc.jdnOfStr(date) - mc.jdnOfStr(last)) / len); st = mc.addDays(last, k * len); predicted = true; }
    const c = mc.jdnOfStr(date) - mc.jdnOfStr(st) + 1;
    const o = mc.addDays(st, len - 14);
    const logged = d.periods.some((p) => date >= p.start && date <= (p.end ?? mc.addDays(p.start, 4)));
    const kind = logged ? 'period' : predicted && c <= 5 ? 'predictedPeriod' : date === o ? 'ovulation' : date >= mc.addDays(o, -5) && date <= mc.addDays(o, 1) ? 'fertile' : 'other';
    days.push({ date, kind, cycleDay: c, logged: logged || d.logs.some((l) => l.date === date) });
  }
  return {
    hasData: true, cyclesLogged: lens.length, avgCycle: Math.round(avg * 10) / 10, avgPeriod: 5, shortest: lens.length ? Math.min(...lens) : null, longest: lens.length ? Math.max(...lens) : null,
    regularity: lens.length >= 3 ? 'regular' : 'unknown', history: lens, lastStart: last, cycleDay: cd, phase, nextStart: next, nextWindow: [mc.addDays(next, -1), mc.addDays(next, 1)],
    daysUntilNext: mc.jdnOfStr(next) - mc.jdnOfStr(today), lateDays: Math.max(0, mc.jdnOfStr(today) - mc.jdnOfStr(next)), ovulation: ovu, fertileStart: fs, fertileEnd: fe,
    calendarFertileDays: null, calendarNote: `Log at least 6 cycles to see lower-chance days (${lens.length} so far).`,
    insights: [`Cycles are regular — about ${len} days (±1).`, `Shortest ${Math.min(...lens)} days, longest ${Math.max(...lens)} days.`], days,
  };
}


// ----- calendar, Ramadan, specials, profile (twin of the Rust side) -----------------
const cal: { settings: CalendarSettings; specials: SpecialDay[]; profile: Profile; ramadan: RamadanSettings } = {
  settings: { hijriAdjust: 0, holidayAlerts: false, showFastingDays: true, mondayThursday: false, fastingAlerts: true, fridayReminders: true, kahfTime: '09:00', makruhAlerts: true },
  specials: [
    { id: 's1', title: "Ammu's birthday", note: 'Call her in the morning', calendar: 'gregorian', month: new Date().getMonth() + 1 === 12 ? 1 : new Date().getMonth() + 2, day: 9, year: null, alert: true, alertTime: '08:00', daysBefore: 1, sound: 'noor_chime', color: '#d9739f', createdAt: 1 },
    { id: 's2', title: 'Wedding anniversary', note: '', calendar: 'gregorian', month: 12, day: 3, year: null, alert: true, alertTime: '09:00', daysBefore: 0, sound: 'noor_bell', color: '#8b7cf6', createdAt: 2 },
  ],
  profile: { name: 'Nazmul', avatar: null, cover: null, photos: [], birthday: '03-14' },
  ramadan: {
    enabled: true, overrideYear: null, overrideStart: null, sehriEndBeforeFajrMin: 0, wakeBeforeMin: 45, sehriWarningMin: 10, sehriEndAlert: true,
    iftarHeadsupMin: 15, iftarAlert: true, leanPrayerAlerts: true, wakeSound: 'noor_dawn', iftarSound: 'noor_chime',
  },
};
const todayStr = () => ymd(new Date());
// `?ramadan` in the preview URL fast-forwards to the middle of Ramadan so the cards can be seen.
const demoRamadan = /[?&]ramadan/.test(window.location.search);

function ramadanRange(s: RamadanSettings, adjust: number, today: string) {
  const range = (hy: number): [string, string] => {
    const manual = s.overrideYear === hy && s.overrideStart ? s.overrideStart : null;
    const start = manual ?? mc.dateForHijri(hy, 9, 1, adjust);
    return [start, mc.addDays(start, mc.hijriMonthLen(hy, 9) - 1)];
  };
  const hy = mc.hijriFor(today, adjust).year;
  const [a, b] = range(hy);
  return today <= b ? { hy, start: a, end: b } : (([x, y]) => ({ hy: hy + 1, start: x, end: y }))(range(hy + 1));
}

function ramadanStatus(): RamadanStatus {
  const s = cal.ramadan;
  const adjust = cal.settings.hijriAdjust;
  const today = todayStr();
  const natural = ramadanRange(s, adjust, today);
  // demo: pretend today is day 12, so the times in the cards line up with the real clock
  const demoStart = mc.addDays(today, -11);
  const { hy, start, end } = demoRamadan ? { hy: natural.hy, start: demoStart, end: mc.addDays(demoStart, 29) } : natural;
  const len = mc.jdnOfStr(end) - mc.jdnOfStr(start) + 1;
  const during = today >= start;
  const timetable = Array.from({ length: len }, (_, i) => {
    const date = mc.addDays(start, i);
    const f = new Date(date + 'T04:58:00').getTime() - (i - 11) * 40_000; // Fajr drifts earlier through the month
    const mg = new Date(date + 'T17:24:00').getTime() + (i - 11) * 25_000;
    const sehriEnd = f - s.sehriEndBeforeFajrMin * 60_000;
    return { date, dayNo: i + 1, fajr: new Date(f).toISOString(), sehriEnd: new Date(sehriEnd).toISOString(), wake: new Date(sehriEnd - s.wakeBeforeMin * 60_000).toISOString(), maghrib: new Date(mg).toISOString() };
  });
  const dayNo = during ? mc.jdnOfStr(today) - mc.jdnOfStr(start) + 1 : 0;
  return {
    settings: s,
    hijriYear: hy,
    start,
    end,
    phase: during ? 'during' : 'upcoming',
    daysUntil: Math.max(0, mc.jdnOfStr(start) - mc.jdnOfStr(today)),
    dayNo,
    daysLeft: during ? mc.jdnOfStr(end) - mc.jdnOfStr(today) : len,
    isEstimate: !(s.overrideYear === hy && s.overrideStart),
    queuedThrough: mc.addDays(demoRamadan ? today : start, 6),
    timetable,
  };
}


// Simulate the iPhone safe areas in the browser preview.
if (!/iPhone|iPad/.test(navigator.userAgent)) {
  document.documentElement.style.setProperty('--n-safe-top', '47px');
  document.documentElement.style.setProperty('--n-safe-bottom', '34px');
}

mockWindows('main');
(window as unknown as { __noorFakeAudio?: boolean }).__noorFakeAudio = true;

// Preview: fake the weather service (no network in the preview); ?wx=rain|storm|cloudy|fog|snow|clear
{
  const wx = new URLSearchParams(window.location.search).get('wx') ?? 'partly';
  const code: Record<string, number> = { clear: 0, partly: 2, cloudy: 3, fog: 45, drizzle: 53, rain: 63, storm: 95, snow: 73 };
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.open-meteo.com')) {
      const body = { current: { temperature_2m: wx === 'snow' ? -2 : 27.4, apparent_temperature: 30.1, weather_code: code[wx] ?? 2, is_day: 1 }, daily: { temperature_2m_max: [31], temperature_2m_min: [21], precipitation_probability_max: [wx === 'rain' || wx === 'storm' ? 80 : 10] } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return real(input, init);
  };
  try {
    localStorage.removeItem('noor.weather.v1');
  } catch {
    /* ignore */
  }
}

mockIPC(
  (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case 'prayer_snapshot':
        return snapshot();
      case 'save_notifications':
        Object.assign(notifications, a.notifications as object);
        return notifications;
      case 'prayer_adjust': {
        const c = a.change as { kind: string; time?: string; minutes?: number };
        const p = a.prayer as string;
        if (c.kind === 'fixed') adjust[p] = { fixed: c.time };
        else if (c.kind === 'offset') adjust[p] = { offset: c.minutes };
        else delete adjust[p];
        return { offsets: {}, manual: {}, mode: Object.values(adjust).some((x) => x.fixed) ? 'manual' : 'calculated' };
      }
      case 'prayer_schedule':
        return schedule(new Date(`${a.date}T12:00:00`));
      case 'prayer_month': {
        const y = a.year as number;
        const m = a.month as number;
        const n = new Date(y, m, 0).getDate();
        return Array.from({ length: n }, (_, i) => schedule(new Date(y, m - 1, i + 1)));
      }
      case 'island_settings':
        return state.settings;
      case 'save_island_settings':
        state.settings = a.settings as typeof state.settings;
        changed('settings');
        return state.settings;
      case 'water_today':
        return waterToday();
      case 'water_add':
        state.water.push({ id: Date.now(), ml: a.ml as number, at: Date.now() });
        changed('water');
        return null;
      case 'water_undo':
        state.water.pop();
        changed('water');
        return null;
      case 'todo_list':
        return state.todos;
      case 'todo_add':
        state.todos.unshift({ id: String(Date.now()), title: a.title as string, done: false, createdAt: Date.now(), doneAt: null, position: 0 });
        changed('todo');
        return null;
      case 'todo_set_done':
        state.todos = state.todos.map((t) => (t.id === a.id ? { ...t, done: a.done as boolean } : t));
        changed('todo');
        return null;
      case 'todo_delete':
        state.todos = state.todos.filter((t) => t.id !== a.id);
        changed('todo');
        return null;
      case 'timer_get':
        return state.timer;
      case 'timer_start': {
        const ms = a.durationMs as number;
        state.timer = { label: (a.label as string) ?? '', durationMs: ms, endsAt: Date.now() + ms, pausedRemaining: null, notified: false };
        changed('timer');
        return state.timer;
      }
      case 'timer_action': {
        const t = state.timer as { endsAt: number | null; pausedRemaining: number | null; durationMs: number; label: string; notified: boolean };
        const now = Date.now();
        if (a.action === 'pause' && t.endsAt) {
          t.pausedRemaining = Math.max(0, t.endsAt - now);
          t.endsAt = null;
        } else if (a.action === 'resume' && t.pausedRemaining != null) {
          t.endsAt = now + t.pausedRemaining;
          t.pausedRemaining = null;
        } else if (a.action === 'add') {
          const ms = (a.ms as number) ?? 60_000;
          if (t.endsAt) t.endsAt += ms;
          else if (t.pausedRemaining != null) t.pausedRemaining += ms;
          t.durationMs += ms;
        } else if (a.action === 'reset') {
          state.timer = { label: '', durationMs: 0, endsAt: null, pausedRemaining: null, notified: false };
        }
        state.timer = { ...state.timer };
        changed('timer');
        return state.timer;
      }
      case 'stopwatch_action': {
        const sw = state.stopwatch;
        const now = Date.now();
        if (a.action === 'start' && !sw.startedAt) sw.startedAt = now as unknown as null;
        else if (a.action === 'stop' && sw.startedAt) {
          sw.accumulatedMs += now - (sw.startedAt as unknown as number);
          sw.startedAt = null;
        } else if (a.action === 'lap') sw.laps = [...sw.laps, sw.accumulatedMs + (sw.startedAt ? now - (sw.startedAt as unknown as number) : 0)];
        else if (a.action === 'reset') state.stopwatch = { startedAt: null, accumulatedMs: 0, laps: [] };
        state.stopwatch = { ...state.stopwatch };
        changed('stopwatch');
        return state.stopwatch;
      }
      case 'stopwatch_get':
        return state.stopwatch;
      case 'clocks_list':
        return [
          { clock: { id: 'c1', label: 'Makkah', timezone: 'Asia/Riyadh', position: 1 }, utcOffsetMin: 180, diffMin: -180 },
          { clock: { id: 'c2', label: 'London', timezone: 'Europe/London', position: 2 }, utcOffsetMin: 0, diffMin: -360 },
          { clock: { id: 'c3', label: 'New York', timezone: 'America/New_York', position: 3 }, utcOffsetMin: -300, diffMin: -660 },
          { clock: { id: 'c4', label: 'Tokyo', timezone: 'Asia/Tokyo', position: 4 }, utcOffsetMin: 540, diffMin: 180 },
        ];
      case 'place_list':
        return state.places;
      case 'place_save': {
        const inp = a.place as Partial<Place> & { name: string; latitude: number; longitude: number; radiusM: number };
        const old = state.places.find((p) => p.id === inp.id);
        const saved: Place = { id: old?.id ?? `p${Date.now()}`, name: inp.name.trim(), latitude: inp.latitude, longitude: inp.longitude, radiusM: inp.radiusM, automated: old?.automated ?? false, createdAt: old?.createdAt ?? Date.now() };
        state.places = old ? state.places.map((p) => (p.id === old.id ? saved : p)) : [...state.places, saved];
        changed('places');
        return saved;
      }
      case 'place_set_automated':
        state.places = state.places.map((p) => (p.id === a.id ? { ...p, automated: a.automated as boolean } : p));
        changed('places');
        return null;
      case 'place_delete':
        state.places = state.places.filter((p) => p.id !== a.id);
        changed('places');
        return null;
      case 'place_status':
        return state.places.map((p) => {
          const d = distanceM(p.latitude, p.longitude, a.latitude as number, a.longitude as number);
          return { id: p.id, distanceM: d, inside: d <= p.radiusM };
        });
      case 'plugin:dialog|open':
        return (a.options as { multiple?: boolean } | undefined)?.multiple ? [SAMPLE_FILE.path] : SAMPLE_FILE.path;
      case 'fitness_live_start':
        (globalThis as { __walkStart?: number }).__walkStart = (a.fromMs as number) ?? Date.now();
        return null;
      case 'fitness_live_stop':
        return null;
      case 'fitness_live': {
        const t = (Date.now() - ((globalThis as { __walkStart?: number }).__walkStart ?? Date.now())) / 1000;
        const steps = Math.floor(t * 1.8);
        return { steps, distanceM: steps * 0.71, speedMps: t > 2 ? 1.35 + 0.1 * Math.sin(t / 5) : 0, cadence: 108, age: 1 };
      }
      case 'idscan_detect':
        return { corners: [{ x: 0.12, y: 0.14 }, { x: 0.86, y: 0.1 }, { x: 0.9, y: 0.84 }, { x: 0.1, y: 0.88 }], found: true, width: 1600, height: 1067 };
      case 'idscan_straighten':
        return `/mock/scan-card-${Date.now()}.jpg`;
      case 'capture_card':
        return { paths: [`/mock/scan-photo-${Date.now()}.jpg`] };
      case 'scan_document':
        return { paths: ['/mock/scan-front.jpg', '/mock/scan-back.jpg'] };
      case 'scan_inputs': {
        const ps = (a.paths as string[] | undefined) ?? [];
        const scans = ps.filter((x) => x.startsWith('/mock/scan-'));
        const files = scans.length ? scans.map((x) => ({ ...SAMPLE_FILE, path: x, name: x.split('/').pop() as string, width: 1600, height: 1009 })) : [SAMPLE_FILE];
        return { files, skipped: [], truncated: false };
      }
      case 'thumbnail':
        return { dataUrl: sample(), width: 1600, height: 1067, hasAlpha: false };
      case 'render_preview':
        return { dataUrl: sample(), previewW: 1600, previewH: 1067, plan, hasAlpha: false, marks: [] };
      case 'plan_operations':
        return plan;
      case 'measure_output':
        return { bytes: 210_000, inputBytes: 482_133, format: 'jpeg', width: 1600, height: 1067 };
      case 'notes_load':
        return [];
      case 'notes_save':
        return null;
      case 'output_dir':
        return '/mock/Noor';
      case 'salah_overview': {
        const from = a.from as string;
        const to = a.to as string;
        const marks = [...salahMarks]
          .map(([k, status]) => ({ date: k.split('|')[0], prayer: k.split('|')[1], status }))
          .filter((m) => m.date >= from && m.date <= to);
        return { marks, stats: salahStats(), qaza: { ...qaza }, today: ymd(new Date()) };
      }
      case 'salah_set': {
        const k = `${a.date}|${a.prayer}`;
        const old = salahMarks.get(k);
        const p = a.prayer as keyof typeof qaza;
        if (a.status) salahMarks.set(k, a.status as string);
        else salahMarks.delete(k);
        if (a.status === 'missed' && old !== 'missed') qaza[p]++;
        if (old === 'missed' && a.status !== 'missed') qaza[p] = Math.max(0, qaza[p] - 1);
        return { ...qaza };
      }
      case 'qaza_save':
        Object.assign(qaza, a.qaza as object);
        return { ...qaza };
      case 'qaza_made_up': {
        const p = a.prayer as keyof typeof qaza;
        if (qaza[p] > 0) {
          qaza[p]--;
          qaza.madeUp++;
        }
        return { ...qaza };
      }
      case 'backup_export':
        return { path: '/tmp/Noor-backup.json', fileName: 'Noor-backup-2026-11-03-1015.json', bytes: 184_320 };
      case 'backup_import':
        return a.json ? (JSON.parse(a.json as string).local ?? {}) : {};
      case 'share_files':
        return null;
      case 'fitness_get':
      case 'fitness_sync_steps':
        return fitnessOverview();
      case 'fitness_report': {
        const o = fitnessOverview();
        const days = a.days as number;
        const list = fitnessData.steps.slice(-days);
        const total = list.reduce((x, y) => x + y.steps, 0);
        const avg = Math.round(total / Math.max(1, list.filter((x) => x.steps > 0).length));
        const kg = o.summary.weight ?? 65;
        const bmr = Math.round(10 * kg + 6.25 * 170.2 - 5 * 35 + 5);
        const tdee = Math.round(bmr * 1.375);
        const best = list.reduce((b, x) => (x.steps > (b?.steps ?? 0) ? x : b), null as null | { date: string; steps: number });
        return {
          days, from: list[0]?.date ?? '', to: o.summary.today, totalSteps: total, avgSteps: avg, best,
          goalDays: list.filter((x) => x.steps >= 8000).length, km: Math.round((total * 170 * 0.415) / 10000) / 10,
          walkKcal: Math.round((total * 0.04 * kg) / 70), activity: avg < 5000 ? 'sedentary' : avg < 7500 ? 'low' : avg < 10000 ? 'somewhat' : 'active',
          weightStart: 72.6, weightEnd: kg, weightChange: Math.round((kg - (days > 7 ? 72.8 : 71.8)) * 10) / 10,
          bmr, tdee, targetKcal: Math.round(Math.max(bmr, tdee - 500) / 10) * 10, weeksToGoal: 8,
          checks: [
            { key: 'weight', level: 'warn', title: 'Overweight', detail: `BMI ${o.summary.bmi}. About ${Math.round((kg - (o.summary.healthyMaxKg ?? 66)) * 10) / 10} kg above the healthy range (${o.summary.healthyMinKg}–${o.summary.healthyMaxKg} kg).` },
            { key: 'activity', level: 'ok', title: 'A little active', detail: `${avg} steps a day. Another 2,500 a day would reach a healthy level.` },
            { key: 'consistency', level: 'ok', title: 'Step goal', detail: `Reached on ${list.filter((x) => x.steps >= 8000).length} of ${days} days.` },
            { key: 'trend', level: 'good', title: 'Weight trend', detail: 'Down 1.2 kg in the last month.' },
          ],
          score: 1, scoreOf: 4,
        };
      }
      case 'voice_get':
        return { settings: mockVoice, events: MOCK_EVENTS, hasBn: true, hasEn: true, ios: true };
      case 'voice_save':
        mockVoice = a.settings as typeof mockVoice;
        return mockVoice;
      case 'voice_test':
        return true;
      case 'optimize_device':
        return { battery: 0.46, charging: 'unplugged', lowPower: false, thermal: 'fair', free: 23.4e9, total: 128e9 };
      case 'optimize_junk_scan':
        return new Promise((r) => setTimeout(() => r(mockJunk), 500));
      case 'optimize_junk_clean': {
        const paths = new Set(a.paths as string[]);
        let freed = 0;
        for (const g of mockJunk) {
          g.files = g.files.filter((f) => (paths.has(f.path) ? ((freed += f.size), false) : true));
        }
        return freed;
      }
      case 'optimize_photos_scan': {
        const part = a.part as 'screenshots' | 'videos' | 'duplicates';
        const all = mockPhotos();
        return new Promise((r) => setTimeout(() => r({ [part]: all[part], scanned: 600 }), part === 'duplicates' ? 1600 : 800));
      }
      case 'optimize_photos_delete':
        return 'ok';
      case 'fitness_motion_available':
        return false;
      case 'fitness_save_profile':
        fitnessData.profile = a.profile as typeof fitnessData.profile;
        return fitnessOverview();
      case 'fitness_log_weight':
        fitnessData.weights = fitnessData.weights.filter((w) => w.date !== a.date);
        if (a.kg != null) fitnessData.weights.push({ date: a.date as string, kg: a.kg as number });
        fitnessData.weights.sort((x, y) => x.date.localeCompare(y.date));
        return fitnessOverview();
      case 'fitness_set_steps':
        fitnessData.steps = fitnessData.steps.filter((x) => x.date !== a.date).concat({ date: a.date as string, steps: a.steps as number, source: 'manual' });
        return fitnessOverview();
      case 'live_activity':
        return null;
      case 'live_activity_supported':
        return false;
      case 'cycle_get':
        return cycleState.data;
      case 'cycle_save':
        cycleState.data = a.data as CycleData;
        changed('cycle');
        return cycleState.data;
      case 'cycle_status':
        return cycleStatusMock();
      case 'calendar_settings':
        return cal.settings;
      case 'calendar_save_settings':
        cal.settings = { ...(a.settings as CalendarSettings), hijriAdjust: Math.max(-2, Math.min(2, (a.settings as CalendarSettings).hijriAdjust)) };
        changed('calendar');
        return cal.settings;
      case 'calendar_month':
        return mc.monthDays(a.year as number, a.month as number, cal.settings.hijriAdjust, cal.settings.showFastingDays, cal.specials);
      case 'calendar_day': {
        const [y, m] = mc.parts(a.date as string);
        return mc.monthDays(y, m, cal.settings.hijriAdjust, cal.settings.showFastingDays, cal.specials).find((d) => d.date === a.date);
      }
      case 'calendar_upcoming':
        return mc.upcoming(a.from as string, a.days as number, cal.settings.hijriAdjust, cal.settings.showFastingDays, !!a.fasting, cal.specials);
      case 'special_list':
        return cal.specials;
      case 'special_save': {
        const inp = a.special as Partial<SpecialDay> & { title: string };
        const old = cal.specials.find((x) => x.id === inp.id);
        const saved = { ...(old ?? {}), ...inp, id: old?.id ?? `s${Date.now()}`, createdAt: old?.createdAt ?? Date.now() } as SpecialDay;
        cal.specials = old ? cal.specials.map((x) => (x.id === old.id ? saved : x)) : [...cal.specials, saved];
        changed('calendar');
        return saved;
      }
      case 'special_delete':
        cal.specials = cal.specials.filter((x) => x.id !== a.id);
        changed('calendar');
        return null;
      case 'profile_get':
        return cal.profile;
      case 'profile_save':
        cal.profile = a.profile as Profile;
        changed('profile');
        return cal.profile;
      case 'ramadan_settings':
        return cal.ramadan;
      case 'ramadan_save_settings':
        cal.ramadan = a.settings as RamadanSettings;
        changed('ramadan');
        return cal.ramadan;
      case 'ramadan_status':
        return ramadanStatus();
      case 'reminder_list':
        return state.reminders;
      case 'notify_sounds':
        return [
          { id: 'noor_chime', label: 'Noor Chime' },
          { id: 'noor_dawn', label: 'Dawn (long)' },
          { id: 'noor_bell', label: 'Bell' },
          { id: 'noor_glass', label: 'Glass' },
          { id: 'noor_soft', label: 'Soft Marimba' },
          { id: 'noor_pop', label: 'Pop' },
          { id: 'noor_timer', label: 'Timer' },
        ];
      case 'notify_upcoming':
        return upcoming().slice(0, (a.limit as number) ?? 60);
      case 'notify_permission':
        return 'granted';
      case 'notify_test':
        // The real app schedules this with iOS; the preview just plays the sound.
        void playSound((a.sound as string) ?? 'default');
        return null;
      case 'timezones':
        return { system: 'Asia/Dhaka', all: ['Asia/Dhaka', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'Asia/Tokyo'] };
      case 'app_info':
        return { name: 'Noor', version: '0.1.0', identifier: 'dev.nazmul.noor', arch: 'aarch64', os: 'ios', settingsPath: '' };
      case 'get_settings':
      case 'save_settings':
        return { ...DEFAULT_SETTINGS, ...((a.settings as object) ?? {}) };
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

// ---- Settings › Optimize (preview data) ----
const mockJunk = [
  {
    id: 'temp', label: 'Temporary files', detail: 'Left over from imports, previews and exports', safe: true,
    files: [
      { path: '/tmp/preview-3f2a.png', name: 'preview-3f2a.png', size: 4_820_000, modified: 1_793_700_000 },
      { path: '/tmp/export-batch.zip', name: 'export-batch.zip', size: 18_200_000, modified: 1_793_600_000 },
      { path: '/tmp/heic-convert.jpg', name: 'heic-convert.jpg', size: 2_310_000, modified: 1_793_500_000 },
    ],
  },
  {
    id: 'imports', label: 'Imported photo copies', detail: 'Copies Noor made when you picked photos in Studio', safe: true,
    files: [{ path: '/cache/imports/IMG_2201.jpg', name: 'IMG_2201.jpg', size: 3_100_000, modified: 1_793_400_000 }],
  },
  {
    id: 'exports', label: 'Studio exports', detail: 'Images you saved from Studio (Files › On My iPhone › Noor)', safe: false,
    files: [
      { path: '/docs/Noor/watermark-01.jpg', name: 'watermark-01.jpg', size: 1_900_000, modified: 1_793_300_000 },
      { path: '/docs/Noor/collage-eid.jpg', name: 'collage-eid.jpg', size: 5_400_000, modified: 1_793_200_000 },
    ],
  },
];

function mockThumb(hue: number, label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${hue + 40},50%,38%)"/></linearGradient></defs><rect width="180" height="180" fill="url(#g)"/><circle cx="130" cy="50" r="18" fill="rgba(255,255,255,.55)"/><path d="M0 150 L60 95 L105 135 L135 110 L180 150 L180 180 L0 180Z" fill="rgba(0,0,0,.25)"/><text x="12" y="28" font-family="sans-serif" font-size="16" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function mockPhotos() {
  const ph = (id: string, hue: number, label: string, size: number, w = 4032, h = 3024, duration = 0) => ({
    id, size, w, h, duration, date: '2026-10-20T10:00:00Z', thumb: mockThumb(hue, label),
  });
  return {
    scanned: 1840,
    duplicates: [
      [ph('d1', 30, 'Eid 1', 3_400_000), ph('d2', 32, 'Eid 2', 3_100_000, 3024, 2268), ph('d3', 28, 'Eid 3', 3_300_000)],
      [ph('d4', 200, 'Beach', 2_900_000), ph('d5', 202, 'Beach', 2_800_000)],
      [ph('d6', 120, 'Garden', 4_100_000), ph('d7', 118, 'Garden', 4_000_000)],
    ],
    screenshots: Array.from({ length: 9 }, (_, i) => ph(`s${i}`, 260 + i * 6, `Shot ${i + 1}`, 900_000 + i * 70_000, 1179, 2556)),
    videos: [ph('v1', 340, '4K video', 812_000_000, 3840, 2160, 214), ph('v2', 10, 'Concert', 356_000_000, 1920, 1080, 402), ph('v3', 170, 'Trip', 98_000_000, 1920, 1080, 61)],
  };
}

// ---- Settings › Language & voice (preview data) ----
let mockVoice: { lang: 'bn' | 'en' | 'mix'; speak: boolean; speakEvents: string[]; texts: Record<string, { bn: string; en: string }> } = {
  lang: 'mix',
  speak: true,
  speakEvents: [],
  texts: {},
};
const MOCK_EVENTS = [{"id": "prayer_start", "label": "Prayer time starts", "bn": "এখন {prayer_of} ওয়াক্ত শুরু হলো", "en": "It's time for {prayer}", "vars": ["prayer", "prayer_of"]}, {"id": "prayer_before", "label": "Before a prayer starts", "bn": "{prayer_of} ওয়াক্ত শুরু হতে {min} মিনিট বাকি", "en": "{prayer} starts in {min} minutes", "vars": ["prayer", "prayer_of", "min"]}, {"id": "prayer_after", "label": "After a prayer started", "bn": "{prayer_of} ওয়াক্ত শুরু হয়েছে {min} মিনিট আগে", "en": "{prayer} started {min} minutes ago", "vars": ["prayer", "prayer_of", "min"]}, {"id": "jamaat_before", "label": "Before jamaat", "bn": "{prayer_of} জামাত {min} মিনিট পর, অজু করে নিন", "en": "{prayer} jamaat in {min} minutes", "vars": ["prayer", "prayer_of", "min"]}, {"id": "jamaat", "label": "Jamaat starts", "bn": "এখন {prayer_of} জামাত শুরু", "en": "{prayer} jamaat is starting now", "vars": ["prayer", "prayer_of"]}, {"id": "sunrise", "label": "Sunrise", "bn": "সূর্যোদয় হয়েছে, ফজরের সময় শেষ", "en": "Sunrise. Fajr time is over", "vars": []}, {"id": "makruh_start", "label": "No-salah time starts", "bn": "এখন নামাজের নিষিদ্ধ সময় শুরু", "en": "No-salah time has started", "vars": []}, {"id": "makruh_end", "label": "No-salah time ends", "bn": "নিষিদ্ধ সময় শেষ, এখন নামাজ পড়া যাবে", "en": "No-salah time is over, you can pray now", "vars": []}, {"id": "sehri_wake", "label": "Sehri wake-up", "bn": "সেহরির সময় হয়েছে, উঠুন", "en": "Wake up, it's time for Sehri", "vars": []}, {"id": "sehri_before", "label": "Before Sehri ends", "bn": "সেহরির সময় শেষ হতে {min} মিনিট বাকি", "en": "Sehri ends in {min} minutes", "vars": ["min"]}, {"id": "sehri_end", "label": "Sehri ends", "bn": "সেহরির সময় শেষ, এখন থেকে রোজা শুরু", "en": "Sehri time is over. Your fast begins", "vars": []}, {"id": "iftar_before", "label": "Before Iftar", "bn": "ইফতারের {min} মিনিট বাকি", "en": "Iftar in {min} minutes", "vars": ["min"]}, {"id": "iftar", "label": "Iftar time", "bn": "ইফতারের সময় হয়েছে", "en": "It's time for Iftar", "vars": []}];
