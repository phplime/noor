import type { AdjustSpec } from '../../types/engine';
import { ADJUST_PRESETS, presetToSpec, type PresetSpec } from '../adjust/presets';

export interface CollageEffect {
  id: string;
  label: string;
  description: string;
  /** null = photos unchanged. */
  spec: AdjustSpec | null;
}

const EXTRA: { id: string; label: string; description: string; spec: PresetSpec }[] = [
  { id: 'sepia', label: 'Sepia', description: 'Warm brown monochrome', spec: { saturation: -75, temperature: 45, tint: 5, contrast: 5 } },
  { id: 'vintage', label: 'Vintage', description: 'Faded, warm film with a soft vignette', spec: { contrast: -12, saturation: -35, temperature: 25, vignette: 25, curves: { rgb: [[0, 0.1], [0.5, 0.52], [1, 0.92]] } } },
  { id: 'fade', label: 'Fade', description: 'Lifted blacks and soft colour', spec: { contrast: -20, saturation: -15, curves: { rgb: [[0, 0.14], [1, 1]] } } },
  { id: 'noir', label: 'Noir', description: 'High-contrast black and white with a vignette', spec: { saturation: -100, contrast: 45, shadows: -10, vignette: 40, sharpness: 15 } },
  { id: 'golden', label: 'Golden', description: 'Golden-hour glow', spec: { temperature: 40, tint: 8, vibrance: 20, highlights: -10, shadows: 10 } },
  { id: 'cinematic', label: 'Cinematic', description: 'Teal shadows, warm highlights', spec: { contrast: 15, saturation: -5, curves: { blue: [[0, 0.1], [0.5, 0.5], [1, 0.9]], red: [[0, 0], [0.5, 0.5], [1, 1]] }, vignette: 20 } },
];

/** Effects for the whole collage: the Adjust & Enhance looks plus a few collage favourites. */
export const COLLAGE_EFFECTS: CollageEffect[] = [
  { id: 'none', label: 'None', description: 'Photos unchanged', spec: null },
  ...[...ADJUST_PRESETS.filter((p) => p.id !== 'original'), ...EXTRA].map((p) => ({ id: p.id, label: p.label, description: p.description, spec: presetToSpec(p.spec) })),
];

export interface FrameStyle {
  id: string;
  label: string;
  /** Values relative to a 1080 px canvas; scaled to the actual canvas size. */
  borderWidth: number;
  borderColor: string;
  shadow: number;
  radius: number;
  gap: number;
  margin: number;
  background?: string;
}

export const FRAME_STYLES: FrameStyle[] = [
  { id: 'clean', label: 'Clean', borderWidth: 0, borderColor: '#ffffff', shadow: 0, radius: 0, gap: 12, margin: 12 },
  { id: 'seamless', label: 'Seamless', borderWidth: 0, borderColor: '#ffffff', shadow: 0, radius: 0, gap: 0, margin: 0 },
  { id: 'white', label: 'White frame', borderWidth: 14, borderColor: '#ffffff', shadow: 35, radius: 0, gap: 24, margin: 30, background: '#ececec' },
  { id: 'black', label: 'Black frame', borderWidth: 10, borderColor: '#111111', shadow: 0, radius: 0, gap: 16, margin: 24, background: '#ffffff' },
  { id: 'rounded', label: 'Soft rounded', borderWidth: 0, borderColor: '#ffffff', shadow: 45, radius: 28, gap: 24, margin: 36, background: '#f4f1ec' },
  { id: 'polaroid', label: 'Instant photo', borderWidth: 18, borderColor: '#fbfaf7', shadow: 60, radius: 4, gap: 36, margin: 48, background: '#d9cfc1' },
  { id: 'gold', label: 'Gold frame', borderWidth: 10, borderColor: '#c9a54c', shadow: 25, radius: 0, gap: 20, margin: 30, background: '#1c1a17' },
  { id: 'dark', label: 'Dark gallery', borderWidth: 0, borderColor: '#ffffff', shadow: 70, radius: 10, gap: 28, margin: 40, background: '#1d1f22' },
];
