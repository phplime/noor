import type { AdjustSpec, Curves } from '../../types/engine';
import { isIdentityCurve, LINEAR } from '../../utils/curve';

export const DEFAULT_ADJUST: AdjustSpec = {
  autoEnhance: false,
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
  sharpness: 0,
  vignette: 0,
  curves: { rgb: LINEAR, red: LINEAR, green: LINEAR, blue: LINEAR },
};

export function isNeutral(a: AdjustSpec): boolean {
  const { curves, autoEnhance, ...sliders } = a;
  return !autoEnhance && Object.values(sliders).every((v) => v === 0) && (Object.values(curves) as Curves[keyof Curves][]).every(isIdentityCurve);
}

export type PresetSpec = Partial<Omit<AdjustSpec, 'curves'>> & { curves?: Partial<Curves> };

/** One-click looks. Each replaces the current sliders (orientation is kept). */
export const ADJUST_PRESETS: { id: string; label: string; description: string; spec: PresetSpec }[] = [
  { id: 'original', label: 'Original', description: 'No adjustments', spec: {} },
  { id: 'auto', label: 'Auto', description: 'Automatic levels with a little vibrance and sharpening', spec: { autoEnhance: true, vibrance: 15, sharpness: 15 } },
  { id: 'vivid', label: 'Vivid', description: 'Punchy contrast and color', spec: { contrast: 15, saturation: 15, vibrance: 25, sharpness: 15 } },
  {
    id: 'portrait',
    label: 'Portrait',
    description: 'Soft, warm and flattering: gentle contrast, lifted shadows, protected highlights',
    spec: { brightness: 8, contrast: -6, highlights: -15, shadows: 15, temperature: 10, saturation: -5, vibrance: 10, curves: { rgb: [[0, 0.03], [0.25, 0.25], [0.75, 0.78], [1, 1]] } },
  },
  { id: 'warm', label: 'Warm', description: 'Golden, sunny tones', spec: { temperature: 30, tint: 5, vibrance: 10 } },
  { id: 'cool', label: 'Cool', description: 'Crisp, blue tones', spec: { temperature: -30, vibrance: 5 } },
  { id: 'bw', label: 'B&W', description: 'Black and white with added contrast', spec: { saturation: -100, contrast: 20 } },
  { id: 'matte', label: 'Matte', description: 'Faded film look', spec: { contrast: -10, saturation: -10, curves: { rgb: [[0, 0.08], [0.5, 0.5], [1, 0.95]] } } },
  { id: 'dramatic', label: 'Dramatic', description: 'Deep contrast, recovered highlights and a vignette', spec: { contrast: 35, highlights: -30, shadows: 20, vibrance: 10, vignette: 35, sharpness: 20 } },
];

/** Expand a preset's partial spec into a full AdjustSpec. */
export function presetToSpec(spec: PresetSpec): AdjustSpec {
  return { ...DEFAULT_ADJUST, ...spec, curves: { ...DEFAULT_ADJUST.curves, ...(spec.curves ?? {}) } };
}
