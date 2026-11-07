import { invoke } from '@tauri-apps/api/core';
import type { Lang } from './lang';

/** Notification language, editable texts and spoken alerts (see src-tauri/src/voice.rs). */

export interface VoiceText {
  bn: string;
  en: string;
}

export interface VoiceSettings {
  lang: Lang;
  speak: boolean;
  /** Event ids that are spoken; empty = all. */
  speakEvents: string[];
  texts: Record<string, VoiceText>;
}

export interface VoiceEvent {
  id: string;
  label: string;
  bn: string;
  en: string;
  vars: string[];
}

export interface VoiceInfo {
  settings: VoiceSettings;
  events: VoiceEvent[];
  hasBn: boolean;
  hasEn: boolean;
  ios: boolean;
}

export const voice = {
  get: () => invoke<VoiceInfo>('voice_get'),
  save: (settings: VoiceSettings) => invoke<VoiceSettings>('voice_save', { settings }),
  /** Real notification in ~5 s that speaks the text (iPhone). Resolves true when spoken audio was made. */
  test: (text: string, lang: Lang) => invoke<boolean>('voice_test', { text, lang }),
};

const NAMES: Record<string, [string, string, string]> = {
  fajr: ['ফজর', 'ফজরের', 'Fajr'],
  dhuhr: ['যোহর', 'যোহরের', 'Dhuhr'],
  asr: ['আসর', 'আসরের', 'Asr'],
  maghrib: ['মাগরিব', 'মাগরিবের', 'Maghrib'],
  isha: ['এশা', 'এশার', 'Isha'],
};

const bnDigits = (s: string) => s.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

/** Same filling as the Rust side, for previews. */
export function renderSample(template: string, l: 'bn' | 'en', prayer = 'isha', min = 10): string {
  const [name, of, en] = NAMES[prayer] ?? NAMES.isha;
  return template
    .replaceAll('{prayer_of}', l === 'en' ? en : of)
    .replaceAll('{prayer}', l === 'en' ? en : name)
    .replaceAll('{min}', l === 'en' ? String(min) : bnDigits(String(min)));
}

/** Speak in the app with the system voices (preview only; real alerts use rendered audio). */
export function speakNow(text: string, l: 'bn' | 'en'): boolean {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return false;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = l === 'en' ? 'en-US' : 'bn-BD';
  const v = synth.getVoices().find((x) => x.lang.toLowerCase().startsWith(l));
  if (v) u.voice = v;
  u.rate = 0.95;
  synth.speak(u);
  return true;
}
