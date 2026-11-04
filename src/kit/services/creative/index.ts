import { save } from '@tauri-apps/plugin-dialog';
import { call } from '../ipc';
import { mobileOutputDir } from '../file-export';
import { isMobile } from '../../utils/platform';
import type { AdjustSpec } from '../../types/engine';

export interface Note {
  id: string;
  title: string;
  html: string;
  pinned: boolean;
  color: string | null;
  created: number;
  updated: number;
}

export interface WriteResult {
  path: string;
  status: 'written' | 'renamed' | 'replaced' | 'skipped';
  bytes: number;
}

export interface CollageCellSpec {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  focusX: number;
  focusY: number;
  zoom: number;
  fit: 'cover' | 'contain';
  radius: number;
}

export interface CollageSpec {
  width: number;
  height: number;
  background: string;
  transparent: boolean;
  cells: CollageCellSpec[];
  /** Colour/tone effect applied to every photo. */
  effect: AdjustSpec | null;
  borderWidth: number;
  borderColor: string;
  /** Drop shadow strength 0–100. */
  shadow: number;
}

/** Same as `collage::shadow_params` in Rust: [blur sigma, y offset, opacity]. */
export function shadowParams(w: number, h: number, strength: number): [number, number, number] {
  const m = Math.min(w, h);
  const k = Math.min(100, Math.max(0, strength)) / 100;
  return [m * 0.012 * (0.5 + k), m * 0.006 * (0.5 + k), 0.15 + 0.45 * k];
}

export const loadNotes = () => call<Note[]>('notes_load');
export const saveNotes = (notes: Note[]) => call<void>('notes_save', { notes });

export const exportCollage = (spec: CollageSpec, path: string, quality: number) => call<WriteResult>('export_collage', { spec, path, quality });

/** Save a canvas data URL through the native, verified, atomic writer. */
export async function saveDataUrl(path: string, dataUrl: string): Promise<WriteResult> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return call<WriteResult>('save_image_bytes', { path, dataBase64: base64 });
}

/** Native Save dialog for an image. Returns null when cancelled. On iOS there is
 * no save dialog: the file goes to Documents/MacKit with a unique name. */
export async function chooseImageDestination(defaultName: string, formats: ('png' | 'jpg' | 'webp')[] = ['png', 'jpg']): Promise<string | null> {
  if (isMobile()) {
    const dot = defaultName.lastIndexOf('.');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return `${await mobileOutputDir()}/${defaultName.slice(0, dot)}-${stamp}${defaultName.slice(dot)}`;
  }
  const r = await save({
    title: 'Save image',
    defaultPath: defaultName,
    filters: [{ name: 'Image', extensions: formats }],
  });
  return r ?? null;
}
