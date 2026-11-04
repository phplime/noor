import { open } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { isAndroid, isIOS } from '../../utils/platform';
import { AppError, call } from '../ipc';
import type { BatchJob, ExportOptions, ImageFormat, OutputFormat, Preflight } from '../../types/engine';
import type { AppSettings } from '../../types/settings';

export const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: 'source', label: 'Same as original' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'tiff', label: 'TIFF' },
  { value: 'bmp', label: 'BMP' },
];

export const FORMAT_INFO: Record<ImageFormat, { label: string; alpha: boolean; lossy: boolean }> = {
  png: { label: 'PNG', alpha: true, lossy: false },
  jpeg: { label: 'JPEG', alpha: false, lossy: true },
  webp: { label: 'WebP', alpha: true, lossy: true },
  tiff: { label: 'TIFF', alpha: true, lossy: false },
  bmp: { label: 'BMP', alpha: false, lossy: false },
  gif: { label: 'GIF', alpha: true, lossy: false },
};

/** The format actually written for a source, mirroring `OutputFormat::resolve` in Rust. */
export function resolveFormat(out: OutputFormat, source: ImageFormat): ImageFormat {
  if (out === 'source') return source === 'gif' ? 'png' : source;
  return out;
}

/** Default export options for a tool, honouring Settings and remembered choices. */
export function defaultExportOptions(settings: AppSettings, toolId: string, suffix: string): ExportOptions {
  const base: ExportOptions = {
    outputDir: settings.defaultOutputDir,
    format: settings.defaultOutputFormat,
    quality: settings.defaultQuality,
    webpLossless: false,
    pngOptimization: 'fast',
    flattenBackground: settings.defaultBackground,
    filenameTemplate: '{name}{suffix}',
    suffix: settings.defaultSuffix.trim() ? settings.defaultSuffix : suffix,
    conflict: settings.defaultConflict,
    preserveStructure: true,
    allowSourceOverwrite: false,
  };
  const remembered = settings.rememberLastExport ? settings.lastExport[toolId] : undefined;
  return remembered ? { ...base, ...remembered, allowSourceOverwrite: false } : base;
}

export async function pickOutputFolder(): Promise<string | null> {
  const r = await open({ title: 'Choose output folder', directory: true, multiple: false });
  return typeof r === 'string' ? r : null;
}

export function preflightBatch(job: BatchJob): Promise<Preflight> {
  return call<Preflight>('preflight_batch', { job });
}

/** iPhone: copy exported images into the Photos library. Returns how many were saved. */
export function saveToPhotos(paths: string[]): Promise<number> {
  return call<number>('save_to_photos', { paths });
}

/** iPhone: open the share sheet ("Save to Files", AirDrop, WhatsApp …). */
export function shareFiles(paths: string[]): Promise<void> {
  return call<void>('share_files', { paths });
}

type Notify = (t: { kind: 'success' | 'error' | 'info' | 'warning'; title: string; message?: string }) => void;

/**
 * The buttons to offer after an export: on iPhone "Save to Photos" and "Save to Files";
 * on the Mac "Show in Finder".
 */
export function savedFileActions(paths: string[], notify: Notify): { label: string; run: () => void }[] {
  if (!paths.length) return [];
  // Android: exports already land in the Gallery (Pictures/Noor).
  if (isAndroid()) return [];
  if (!isIOS()) return [{ label: 'Show in Finder', run: () => void revealInFinder(paths[0]) }];
  return [
    {
      label: 'Save to Photos',
      run: () =>
        void saveToPhotos(paths)
          .then((n) => notify({ kind: 'success', title: n === 1 ? 'Saved to Photos' : `${n} images saved to Photos` }))
          .catch((e) => notify({ kind: 'error', title: 'Not saved to Photos', message: AppError.from(e).message })),
    },
    {
      label: 'Save to Files',
      run: () => void shareFiles(paths).catch((e) => notify({ kind: 'error', title: 'Could not open sharing', message: AppError.from(e).message })),
    },
  ];
}

/** Show an exported file: Finder on the Mac, the Files app on iOS. */
export async function revealInFinder(path: string): Promise<void> {
  if (isIOS()) {
    // `shareddocuments://` opens the Files app at a folder inside our Documents.
    const dir = path.slice(0, path.lastIndexOf('/'));
    await openUrl(`shareddocuments://${encodeURI(dir)}`);
    return;
  }
  await revealItemInDir(path);
}

let mobileDir: Promise<string> | null = null;
/** iOS export folder (Documents/MacKit, visible in the Files app). */
export function mobileOutputDir(): Promise<string> {
  mobileDir ??= call<string>('output_dir');
  return mobileDir;
}

/** Client-side preview of the generated filename (the Rust engine is authoritative). */
export function previewFilename(template: string, suffix: string, stem: string, w: number, h: number, ext: string): string {
  const t = template.trim() === '' ? '{name}{suffix}' : template;
  const raw = t
    .split('{suffix}')
    .join(suffix)
    .split('{name}')
    .join(stem)
    .split('{w}')
    .join(String(w))
    .split('{h}')
    .join(String(h))
    .split('{index}')
    .join('001')
    .split('{ext}')
    .join(ext);
  const clean = raw.replace(/[/\\:*?"<>|]/g, '-').replace(/^[.\s]+/, '').trim() || 'image';
  return `${clean}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

export function extensionFor(f: ImageFormat): string {
  return f === 'jpeg' ? 'jpg' : f;
}
