import { openUrl } from '@tauri-apps/plugin-opener';

/** Map a sound setting to the bundled file (same rules as src-tauri/src/notify.rs). */
export function soundFile(name: string): string | null {
  switch (name.trim()) {
    case '':
    case 'none':
      return null;
    case 'default':
      return 'noor_chime';
    case 'Glass':
    case 'Ping':
      return 'noor_glass';
    case 'Pop':
    case 'Bottle':
      return 'noor_pop';
    case 'Tink':
    case 'Morse':
      return 'noor_bell';
    case 'Hero':
    case 'Submarine':
      return 'noor_dawn';
    case 'Purr':
    case 'Blow':
      return 'noor_soft';
    default:
      return name.startsWith('noor_') ? name : 'noor_chime';
  }
}

// Sounds are played with Web Audio, not an <audio> element: iOS shows any <audio>/<video>
// playback as "Now Playing" on the lock screen. With the audio session set to "ambient"
// the short previews mix with other audio, follow the Silent switch and never take over
// the lock screen. The context is suspended after each sound so the session is released.

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let idle: number | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();

function audio(): AudioContext | null {
  try {
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession && nav.audioSession.type !== 'ambient') nav.audioSession.type = 'ambient';
  } catch {
    /* older WebKit: no audio session API */
  }
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function load(c: AudioContext, file: string): Promise<AudioBuffer> {
  let p = buffers.get(file);
  if (!p) {
    p = fetch(`sounds/${file}.wav`)
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b));
    p.catch(() => buffers.delete(file));
    buffers.set(file, p);
  }
  return p;
}

/** Play a notification sound inside the app (preview only — real alerts are played by iOS). */
/**
 * Play a sound. Alert sounds ring twice, like the notifications themselves
 * (pass `times: 1` for short UI sounds such as the tasbih tap).
 */
export async function playSound(name: string, times = 2): Promise<void> {
  stopSound();
  const file = soundFile(name);
  if (!file) return;
  const c = audio();
  if (!c) return;
  try {
    window.clearTimeout(idle);
    if (c.state !== 'running') await c.resume();
    const buf = await load(c, file);
    const gap = buf.duration < 0.6 ? 0.25 : 0.7;
    const t0 = c.currentTime + 0.02;
    let last: AudioBufferSourceNode | null = null;
    for (let k = 0; k < Math.max(1, times); k++) {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.connect(c.destination);
      s.start(t0 + k * (buf.duration + gap));
      extra.push(s);
      last = s;
    }
    if (last) {
      last.onended = () => {
        if (source === last) source = null;
        extra = [];
        // give the audio session back so nothing lingers on the lock screen
        idle = window.setTimeout(() => void c.suspend().catch(() => undefined), 400);
      };
      source = last;
    }
  } catch {
    /* autoplay restrictions or decode failure: ignore */
  }
}

let extra: AudioBufferSourceNode[] = [];

export function stopSound() {
  for (const s of extra) {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  extra = [];
  try {
    source?.stop();
  } catch {
    /* already stopped */
  }
  source = null;
}

/** Noor's page in the iOS Settings app (notifications, location, photos). */
export async function openAppSettings(): Promise<void> {
  try {
    await openUrl('app-settings:');
  } catch {
    /* desktop preview: nothing to open */
  }
}
