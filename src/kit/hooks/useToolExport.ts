import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { defaultExportOptions } from '../services/file-export';
import type { ExportOptions } from '../types/engine';

/**
 * Export options for a tool, initialised from Settings (and remembered
 * last-used options) once settings have loaded.
 */
export function useToolExport(toolId: string, suffix: string, overrides?: Partial<ExportOptions>) {
  const { settings, settingsLoaded } = useApp();
  const [opts, setOpts] = useState<ExportOptions>(() => ({ ...defaultExportOptions(settings, toolId, suffix), ...overrides }));
  const initialised = useRef(false);
  useEffect(() => {
    if (settingsLoaded && !initialised.current) {
      initialised.current = true;
      setOpts({ ...defaultExportOptions(settings, toolId, suffix), ...overrides });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);
  return [opts, setOpts] as const;
}

/** Run `fn` once, right after settings have loaded. */
export function useOnSettingsLoaded(fn: () => void) {
  const { settingsLoaded } = useApp();
  const done = useRef(false);
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (settingsLoaded && !done.current) {
      done.current = true;
      cb.current();
    }
  }, [settingsLoaded]);
}
