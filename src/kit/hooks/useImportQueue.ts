import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../app/AppContext';
import { mergeQueue, pickFolder, pickImageFiles, scanInputs } from '../services/file-import';
import { isMobile } from '../utils/platform';
import { AppError } from '../services/ipc';
import type { ScannedFile, SkippedFile } from '../types/engine';
import { basename } from '../utils/format';
import { useFileDrop } from './useDragDrop';
import { useShortcut } from './useShortcut';

interface Options {
  /** Single-image tools replace the current image instead of queueing. */
  multiple?: boolean;
}

export function useImportQueue({ multiple = true }: Options = {}) {
  const { settings, notify } = useApp();
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [includeSubfolders, setIncludeSubfolders] = useState(settings.includeSubfolders);
  const [scanning, setScanning] = useState(false);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);

  useEffect(() => setIncludeSubfolders(settings.includeSubfolders), [settings.includeSubfolders]);

  const addPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      setScanning(true);
      try {
        const res = await scanInputs(paths, includeSubfolders);
        setSkipped(res.skipped);
        if (!res.files.length) {
          notify({
            kind: 'warning',
            title: 'No supported images found',
            message: res.skipped.length
              ? `${res.skipped.length} file(s) skipped — ${res.skipped[0].reason} (${basename(res.skipped[0].path)})`
              : 'Supported formats: PNG, JPEG, WebP, BMP, TIFF, GIF.',
          });
          return;
        }
        if (!multiple) {
          const first = res.files[0];
          setFiles([first]);
          setSelected(first.path);
        } else {
          setFiles((q) => {
            const { queue, added } = mergeQueue(q, res.files);
            if (added < res.files.length) {
              notify({ kind: 'info', title: `${res.files.length - added} file(s) were already in the list` });
            }
            return queue;
          });
          setSelected((s) => s ?? res.files[0].path);
        }
        if (res.skipped.length) {
          notify({
            kind: 'warning',
            title: `${res.skipped.length} file(s) skipped`,
            message: res.skipped
              .slice(0, 3)
              .map((s) => `${basename(s.path)}: ${s.reason}`)
              .join('\n'),
          });
        }
        if (res.truncated) {
          notify({ kind: 'warning', title: 'Too many files', message: 'Only the first 5,000 images were added.' });
        }
      } catch (e) {
        notify({ kind: 'error', title: 'Could not read the selection', message: AppError.from(e).message });
      } finally {
        setScanning(false);
      }
    },
    [includeSubfolders, multiple, notify],
  );

  const addFiles = useCallback(async () => {
    try {
      const paths = await pickImageFiles(multiple, multiple ? 'Add images' : 'Open image');
      await addPaths(paths);
    } catch (e) {
      notify({ kind: 'error', title: 'Could not open the file picker', message: AppError.from(e).message });
    }
  }, [addPaths, multiple, notify]);

  const addFolder = useCallback(async () => {
    try {
      if (isMobile()) {
        // iOS can't import whole folders: this button opens the Files app instead.
        await addPaths(await pickImageFiles(multiple, 'Add images from Files', 'files'));
        return;
      }
      const dir = await pickFolder('Add a folder of images');
      if (dir) await addPaths([dir]);
    } catch (e) {
      notify({ kind: 'error', title: 'Could not open the folder picker', message: AppError.from(e).message });
    }
  }, [addPaths, notify]);

  const remove = useCallback((path: string) => {
    setFiles((q) => q.filter((f) => f.path !== path));
    setSelected((s) => (s === path ? null : s));
  }, []);

  const clear = useCallback(() => {
    setFiles([]);
    setSelected(null);
    setSkipped([]);
  }, []);

  useEffect(() => {
    if (!selected && files.length) setSelected(files[0].path);
  }, [files, selected]);

  const dragOver = useFileDrop(addPaths);
  useShortcut('mod+o', () => void addFiles());
  useShortcut('mod+shift+o', () => void addFolder(), multiple);

  const selectedFile = files.find((f) => f.path === selected) ?? null;

  return {
    files,
    selected,
    selectedFile,
    setSelected,
    includeSubfolders,
    setIncludeSubfolders,
    scanning,
    skipped,
    addPaths,
    addFiles,
    addFolder,
    remove,
    clear,
    dragOver,
  };
}

export type ImportQueue = ReturnType<typeof useImportQueue>;
