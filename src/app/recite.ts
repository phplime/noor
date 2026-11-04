import { useEffect, useState } from 'react';

/**
 * Qur'an recitation, streamed one ayah at a time from everyayah.com
 * (64 kbps ≈ 30–150 KB per ayah), so nothing is added to the app's size.
 * The ayah being recited is highlighted in the reader.
 */

export interface Reciter {
  id: string;
  folder: string;
  en: string;
  bn: string;
}

export const RECITERS: Reciter[] = [
  { id: 'alafasy', folder: 'Alafasy_64kbps', en: 'Mishary Alafasy', bn: 'মিশারি আল-আফাসি' },
  { id: 'abdulbasit', folder: 'Abdul_Basit_Murattal_64kbps', en: 'Abdul Basit (Murattal)', bn: 'আব্দুল বাসিত' },
  { id: 'husary', folder: 'Husary_64kbps', en: 'Mahmoud Al-Husary', bn: 'মাহমুদ আল-হুসারি' },
  { id: 'sudais', folder: 'Abdurrahmaan_As-Sudais_64kbps', en: 'Abdurrahman As-Sudais', bn: 'আব্দুর রহমান আস-সুদাইস' },
  { id: 'muaiqly', folder: 'Maher_AlMuaiqly_64kbps', en: 'Maher Al-Muaiqly', bn: 'মাহের আল-মুআইকিলি' },
  { id: 'ghamdi', folder: 'Ghamadi_40kbps', en: 'Saad Al-Ghamdi', bn: 'সাদ আল-গামদি' },
];

const pad = (n: number) => String(n).padStart(3, '0');
export const ayahUrl = (folder: string, s: number, a: number) => `https://everyayah.com/data/${folder}/${pad(s)}${pad(a)}.mp3`;

export type RecitePhase = 'idle' | 'loading' | 'playing' | 'paused';

export interface ReciteState {
  phase: RecitePhase;
  surah: number;
  /** 0 = the Bismillah before the surah. */
  ayah: number;
  total: number;
  reciter: string;
  repeat: boolean;
  title: string;
  error: string | null;
}

const PREF = 'noor.recite.v1';

function prefs(): { reciter: string; repeat: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) ?? '{}');
    return { reciter: RECITERS.some((r) => r.id === p.reciter) ? p.reciter : 'alafasy', repeat: !!p.repeat };
  } catch {
    return { reciter: 'alafasy', repeat: false };
  }
}

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

function session(type: 'playback' | 'ambient') {
  try {
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession && nav.audioSession.type !== type) nav.audioSession.type = type;
  } catch {
    /* no audio session API */
  }
}

/** Preview builds can't reach the audio server: simulate playback. */
const FAKE = () => !!(window as unknown as { __noorFakeAudio?: boolean }).__noorFakeAudio;

class Player {
  state: ReciteState = { phase: 'idle', surah: 0, ayah: 0, total: 0, reciter: prefs().reciter, repeat: prefs().repeat, title: '', error: null };
  private audio: HTMLAudioElement | null = null;
  private warm: HTMLAudioElement | null = null;
  private fakeTimer: number | undefined;
  private idleTimer: number | undefined;
  private subs = new Set<(s: ReciteState) => void>();

  subscribe(f: (s: ReciteState) => void) {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  }

  private set(patch: Partial<ReciteState>) {
    this.state = { ...this.state, ...patch };
    this.subs.forEach((f) => f(this.state));
    this.updateSession();
  }

  private folder() {
    return (RECITERS.find((r) => r.id === this.state.reciter) ?? RECITERS[0]).folder;
  }

  private el() {
    if (!this.audio) {
      const a = new Audio();
      a.preload = 'auto';
      a.addEventListener('playing', () => this.set({ phase: 'playing', error: null }));
      a.addEventListener('waiting', () => this.state.phase !== 'paused' && this.set({ phase: 'loading' }));
      a.addEventListener('ended', () => this.advance());
      a.addEventListener('error', () => {
        if (this.state.phase === 'idle') return;
        this.set({ phase: 'paused', error: navigator.onLine === false ? 'Recitation needs an internet connection' : 'This ayah could not be loaded' });
      });
      this.audio = a;
    }
    return this.audio;
  }

  /** Start a surah at an ayah (0 = Bismillah first). */
  play(surah: number, ayah: number, total: number, title: string) {
    const start = ayah <= 1 && surah !== 1 && surah !== 9 ? 0 : Math.max(1, ayah);
    this.set({ surah, total, title, ayah: start, phase: 'loading', error: null });
    this.load();
  }

  private load() {
    window.clearTimeout(this.idleTimer);
    const { surah, ayah, total } = this.state;
    session('playback');
    if (FAKE()) {
      window.clearTimeout(this.fakeTimer);
      this.set({ phase: 'playing' });
      this.fakeTimer = window.setTimeout(() => this.advance(), 2500);
      return;
    }
    const a = this.el();
    // Ayah 0 is the Bismillah, recorded as 1:1.
    a.src = ayah === 0 ? ayahUrl(this.folder(), 1, 1) : ayahUrl(this.folder(), surah, ayah);
    void a.play().catch(() => this.set({ phase: 'paused' }));
    // Warm the cache for the next ayah so there's no gap.
    if (ayah < total) {
      this.warm ??= new Audio();
      this.warm.preload = 'auto';
      this.warm.src = ayahUrl(this.folder(), surah, ayah + 1);
      this.warm.load();
    }
  }

  private advance() {
    const { ayah, total, repeat } = this.state;
    if (repeat && ayah > 0) return this.load();
    if (ayah >= total) return this.stop();
    this.set({ ayah: ayah + 1, phase: 'loading' });
    this.load();
  }

  toggle() {
    if (this.state.phase === 'idle') return;
    if (this.state.phase === 'paused') {
      if (FAKE()) {
        this.set({ phase: 'playing' });
        this.fakeTimer = window.setTimeout(() => this.advance(), 2500);
      } else {
        window.clearTimeout(this.idleTimer);
        void this.el().play();
      }
    } else {
      if (FAKE()) window.clearTimeout(this.fakeTimer);
      else this.audio?.pause();
      this.set({ phase: 'paused' });
      // Battery: a long pause gives the audio session back so iOS can suspend Noor.
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => this.state.phase === 'paused' && this.stop(), 5 * 60_000);
    }
  }

  step(d: number) {
    const next = Math.min(this.state.total, Math.max(this.state.surah === 1 || this.state.surah === 9 ? 1 : 0, this.state.ayah + d));
    this.set({ ayah: next, phase: 'loading' });
    this.load();
  }

  goto(ayah: number) {
    this.set({ ayah, phase: 'loading' });
    this.load();
  }

  stop() {
    window.clearTimeout(this.fakeTimer);
    window.clearTimeout(this.idleTimer);
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.warm?.removeAttribute('src');
    this.set({ phase: 'idle', error: null });
    session('ambient');
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    } catch {
      /* ignore */
    }
  }

  setReciter(id: string) {
    this.saveSettings({ reciter: id });
    if (this.state.phase !== 'idle') this.load();
  }

  setRepeat(on: boolean) {
    this.saveSettings({ repeat: on });
  }

  private saveSettings(patch: Partial<{ reciter: string; repeat: boolean }>) {
    const next = { reciter: this.state.reciter, repeat: this.state.repeat, ...patch };
    try {
      localStorage.setItem(PREF, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    this.set(next);
  }

  /** Lock-screen / Control Centre controls while reciting. */
  private updateSession() {
    if (!('mediaSession' in navigator) || this.state.phase === 'idle') return;
    try {
      const r = RECITERS.find((x) => x.id === this.state.reciter);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${this.state.title} · ${this.state.ayah === 0 ? 'Bismillah' : `Ayah ${this.state.ayah}`}`,
        artist: r?.en ?? 'Recitation',
        album: 'Noor · Qur’an',
      });
      navigator.mediaSession.setActionHandler('play', () => this.toggle());
      navigator.mediaSession.setActionHandler('pause', () => this.toggle());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.step(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => this.step(-1));
    } catch {
      /* ignore */
    }
  }
}

export const reciter = new Player();

export function useRecitation(): ReciteState {
  const [s, setS] = useState(reciter.state);
  useEffect(() => reciter.subscribe(setS), []);
  return s;
}
