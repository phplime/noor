import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isTauri } from '../services/ipc';

/**
 * Native file drag & drop. Browsers do not expose file paths, so this uses
 * Tauri's webview drag-drop events, which deliver absolute paths.
 */
export function useFileDrop(onDrop: (paths: string[]) => void, enabled = true): boolean {
  const [over, setOver] = useState(false);
  const cb = useRef(onDrop);
  cb.current = onDrop;
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === 'enter' || p.type === 'over') setOver(true);
        else if (p.type === 'leave') setOver(false);
        else if (p.type === 'drop') {
          setOver(false);
          if (p.paths.length) cb.current(p.paths);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
      setOver(false);
    };
  }, [enabled]);
  return over;
}
