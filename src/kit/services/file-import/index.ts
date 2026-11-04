import { open } from '@tauri-apps/plugin-dialog';
import { isAndroid, isIOS, toFsPath } from '../../utils/platform';
import { invoke } from '@tauri-apps/api/core';
import { call } from '../ipc';
import type { ScanResult, ScannedFile } from '../../types/engine';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif'];

/** Ask the user for one or more image files. Returns absolute paths (empty if cancelled). */
/**
 * Choose images. On iOS `source` picks between the Photos library (default) and
 * the Files app; picked files are copied into MacKit's sandbox by the system.
 */
export async function pickImageFiles(multiple = true, title = 'Choose images', source: 'photos' | 'files' = 'photos'): Promise<string[]> {
  if (isAndroid()) return pickAndroid(multiple);
  const result = await open({
    title,
    multiple,
    directory: false,
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
    ...(isIOS() ? { pickerMode: source === 'photos' ? ('image' as const) : ('document' as const) } : {}),
  });
  if (!result) return [];
  return (Array.isArray(result) ? result : [result]).map(toFsPath);
}

/**
 * Android: the system picker returns `content://` links the engine can't open, so use
 * the photo picker (via a file input) and copy each image into Noor's cache.
 */
function chooseFiles(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.style.display = 'none';
    let done = false;
    const finish = (files: File[]) => {
      if (done) return;
      done = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    // No 'change' after the picker closes → cancelled.
    const onFocus = () => window.setTimeout(() => finish(Array.from(input.files ?? [])), 800);
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

async function pickAndroid(multiple: boolean): Promise<string[]> {
  const files = await chooseFiles(multiple);
  const paths: string[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    paths.push(await invoke<string>('import_image', bytes, { headers: { 'x-name': encodeURIComponent(f.name || 'image.jpg') } }));
  }
  return paths;
}

export async function pickFolder(title = 'Choose a folder'): Promise<string | null> {
  const result = await open({ title, directory: true, multiple: false });
  return typeof result === 'string' ? toFsPath(result) : null;
}

/** Expand files/folders into supported images (headers only; fast). */
export function scanInputs(paths: string[], recursive: boolean): Promise<ScanResult> {
  return call<ScanResult>('scan_inputs', { paths, recursive });
}

/** Merge newly scanned files into a queue, skipping duplicates by path. */
export function mergeQueue(queue: ScannedFile[], incoming: ScannedFile[]): { queue: ScannedFile[]; added: number } {
  const seen = new Set(queue.map((f) => f.path));
  const fresh = incoming.filter((f) => !seen.has(f.path));
  return { queue: [...queue, ...fresh], added: fresh.length };
}
