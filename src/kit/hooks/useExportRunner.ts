import { createElement, useCallback, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { cancelBatch, runBatch } from '../services/batch-processor';
import { mobileOutputDir, preflightBatch, savedFileActions } from '../services/file-export';
import { isMobile } from '../utils/platform';
import { AppError } from '../services/ipc';
import type { BatchItem, BatchSummary, ExportOptions, ItemUpdate, Operation } from '../types/engine';
import { basename, dirname, formatBytes } from '../utils/format';

export interface RunState {
  running: boolean;
  total: number;
  finished: number;
  statuses: Map<string, ItemUpdate>;
  summary: BatchSummary | null;
}

const EMPTY: RunState = { running: false, total: 0, finished: 0, statuses: new Map(), summary: null };

/**
 * The single export path used by every image tool: pre-flight checks (errors,
 * name conflicts, original-file protection), confirmation, background batch
 * processing with live progress, and an honest final summary.
 */
export function useExportRunner(toolId: string) {
  const { notify, confirm, settings, rememberExport } = useApp();
  const [state, setState] = useState<RunState>(EMPTY);
  const jobRef = useRef<string | null>(null);

  const run = useCallback(
    async (items: BatchItem[], operations: Operation[], exportOptions: ExportOptions): Promise<BatchSummary | null> => {
      if (!items.length) {
        notify({ kind: 'warning', title: 'Nothing to export', message: 'Add at least one image first.' });
        return null;
      }
      let opts = { ...exportOptions };
      // iOS: picked photos live in a temporary copy, so "next to the original"
      // would be lost. Everything goes to Documents/MacKit (the Files app).
      if (isMobile()) opts = { ...opts, outputDir: await mobileOutputDir(), preserveStructure: false };
      let job = { items, operations, export: opts };

      // ---- Pre-flight: nothing is written yet ----
      let pf;
      try {
        pf = await preflightBatch(job);
      } catch (e) {
        notify({ kind: 'error', title: 'Cannot export', message: AppError.from(e).message });
        return null;
      }

      if (pf.errors === items.length) {
        const first = pf.items.find((i) => i.error)?.error;
        notify({ kind: 'error', title: items.length === 1 ? 'Cannot export this image' : 'None of the images can be exported', message: first?.message });
        return null;
      }
      if (pf.errors > 0) {
        const list = pf.items
          .filter((i) => i.error)
          .slice(0, 8)
          .map((i) => createElement('div', { key: i.index }, `${basename(i.path)} — ${i.error?.message}`));
        const go = await confirm({
          title: `${pf.errors} of ${items.length} images cannot be processed`,
          message: createElement('div', null, createElement('p', null, 'These files will be reported as failed. Continue with the others?'), createElement('div', { className: 'dialog-list' }, list)),
          confirmLabel: 'Continue',
        });
        if (!go) return null;
      }

      if (pf.sourceOverwrites > 0 && !opts.allowSourceOverwrite) {
        notify({
          kind: 'error',
          title: 'This would replace your original files',
          message: 'The output name and folder are the same as the original. Add a suffix, choose another format, or pick an output folder. (Replacing originals must be explicitly allowed in the export options.)',
        });
        return null;
      }
      if (pf.sourceOverwrites > 0 && opts.allowSourceOverwrite) {
        const ok = await confirm({
          title: `Replace ${pf.sourceOverwrites} original file(s)?`,
          message: 'The original images will be permanently replaced by the processed versions. This cannot be undone.',
          confirmLabel: 'Replace Originals',
          destructive: true,
        });
        if (!ok) return null;
      }

      if (pf.conflicts > 0 && (settings.confirmOverwrite || opts.conflict === 'replace')) {
        const names = pf.items
          .filter((i) => i.exists && !i.isSource)
          .slice(0, 8)
          .map((i) => createElement('div', { key: i.index, className: 'mono' }, basename(i.outputPath ?? '')));
        const choice = await confirm({
          title: `${pf.conflicts} output file(s) already exist`,
          message: createElement('div', null, createElement('p', null, 'Choose what to do with files that already exist in the output folder:'), createElement('div', { className: 'dialog-list' }, names)),
          confirmLabel: 'Keep Both',
          extra: [
            { label: 'Skip', value: 'skip' },
            { label: 'Replace', value: 'replace' },
          ],
        });
        if (!choice) return null;
        opts = { ...opts, conflict: choice === 'confirm' ? 'rename' : (choice as 'skip' | 'replace') };
        job = { ...job, export: opts };
      }

      rememberExport(toolId, exportOptions);

      // ---- Run ----
      const statuses = new Map<string, ItemUpdate>();
      setState({ running: true, total: items.length, finished: 0, statuses, summary: null });
      let finished = 0;
      try {
        const { jobId, done } = await runBatch(job, {
          onItem: (u) => {
            statuses.set(u.path, u);
            if (u.status !== 'processing') finished += 1;
            setState((s) => ({ ...s, finished, statuses: new Map(statuses) }));
          },
        });
        jobRef.current = jobId;
        const summary = await done;
        jobRef.current = null;
        setState((s) => ({ ...s, running: false, summary }));
        report(summary, [...statuses.values()]);
        return summary;
      } catch (e) {
        jobRef.current = null;
        setState((s) => ({ ...s, running: false }));
        notify({ kind: 'error', title: 'Export failed to start', message: AppError.from(e).message });
        return null;
      }

      function report(summary: BatchSummary, updates: ItemUpdate[]) {
        const outputs = updates.filter((u) => u.status === 'done' && u.outputPath);
        const actions = savedFileActions(outputs.map((o) => o.outputPath!), notify);
        if (summary.succeeded === 0) {
          const firstErr = updates.find((u) => u.status === 'failed')?.message;
          notify({
            kind: summary.wasCancelled ? 'warning' : 'error',
            title: summary.wasCancelled ? 'Export cancelled — nothing was saved' : 'No files were exported',
            message: summary.skipped ? `${summary.skipped} skipped because the output already exists.` : firstErr ?? undefined,
          });
          return;
        }
        const parts = [`${summary.succeeded} saved`];
        if (summary.skipped) parts.push(`${summary.skipped} skipped`);
        if (summary.failed) parts.push(`${summary.failed} failed`);
        if (summary.cancelled) parts.push(`${summary.cancelled} cancelled`);
        const single = items.length === 1 && outputs[0];
        notify({
          kind: summary.failed || summary.cancelled ? 'warning' : 'success',
          title: single ? `Saved ${basename(outputs[0].outputPath!)}` : `Export finished: ${parts.join(', ')}`,
          message: single
            ? `${outputs[0].outputW} × ${outputs[0].outputH} px (verified) · ${formatBytes(outputs[0].outputBytes)} · in ${dirname(outputs[0].outputPath!)}`
            : `${formatBytes(summary.outputBytes)} written · sizes verified on disk`,
          actions,
        });
      }
    },
    [confirm, notify, rememberExport, settings.confirmOverwrite, toolId],
  );

  const cancel = useCallback(async () => {
    if (jobRef.current) await cancelBatch(jobRef.current);
  }, []);

  const reset = useCallback(() => setState(EMPTY), []);

  return { ...state, run, cancel, reset };
}
