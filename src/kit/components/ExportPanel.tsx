import { useApp } from '../app/AppContext';
import { Callout, Checkbox, ColorField, Field, Section, Segmented, Select, Slider } from './Field';
import { Icon } from './Icon';
import { IOS_EXPORT_LOCATION, isMobile } from '../utils/platform';
import { FORMAT_INFO, OUTPUT_FORMATS, pickOutputFolder, previewFilename, resolveFormat, extensionFor } from '../services/file-export';
import type { ConflictPolicy, ExportOptions, ImageFormat, OutputFormat, PngOptimization } from '../types/engine';
import { shortPath } from '../utils/format';

interface ExportPanelProps {
  value: ExportOptions;
  onChange: (v: ExportOptions) => void;
  /** Formats of the selected sources (for transparency/quality hints). */
  sourceFormats: ImageFormat[];
  /** The operations themselves add transparency (e.g. transparent padding). */
  introducesAlpha?: boolean;
  /** Example for the filename preview. */
  sample?: { stem: string; w: number; h: number; format: ImageFormat };
  showPreserveStructure?: boolean;
  title?: string;
  hideFormat?: boolean;
}

export function ExportPanel({ value, onChange, sourceFormats, introducesAlpha = false, sample, showPreserveStructure = true, title = 'Export', hideFormat }: ExportPanelProps) {
  const { confirm } = useApp();
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => onChange({ ...value, [k]: v });
  const resolved = Array.from(new Set((sourceFormats.length ? sourceFormats : (['png'] as ImageFormat[])).map((f) => resolveFormat(value.format, f))));
  const anyLossy = resolved.some((f) => FORMAT_INFO[f].lossy);
  // Transparency must be flattened when a source that can carry alpha (or alpha added by the
  // operations) ends up in a format without alpha.
  const flattenTargets = Array.from(
    new Set(
      (sourceFormats.length ? sourceFormats : (['png'] as ImageFormat[]))
        .filter((f) => introducesAlpha || FORMAT_INFO[f].alpha)
        .map((f) => resolveFormat(value.format, f))
        .filter((f) => !FORMAT_INFO[f].alpha),
    ),
  );
  const anyPng = resolved.includes('png');
  const anyWebp = resolved.includes('webp');

  const exampleName = sample
    ? previewFilename(value.filenameTemplate, value.suffix, sample.stem, sample.w, sample.h, extensionFor(resolveFormat(value.format, sample.format)))
    : null;

  return (
    <Section title={title}>
      {!hideFormat && (
        <Select<OutputFormat>
          label="Format"
          value={value.format}
          onChange={(v) => set('format', v)}
          options={OUTPUT_FORMATS}
          info="“Same as original” keeps each file's format. GIF files are written as PNG."
        />
      )}

      {anyLossy && (
        <Field label="Quality" info="Lower quality gives smaller files. Applies to JPEG and lossy WebP. The real size is measured after export.">
          <Slider value={value.quality} min={1} max={100} onChange={(v) => set('quality', v)} format={(v) => `${v}`} ariaLabel="Quality" />
        </Field>
      )}
      {anyWebp && (
        <div className="field">
          <Checkbox checked={value.webpLossless} onChange={(v) => set('webpLossless', v)} label="Lossless WebP" title="Pixel-perfect WebP (ignores the quality setting)" />
        </div>
      )}
      {anyPng && (
        <Field label="PNG optimization" info="Lossless: pixels stay identical, only the file encoding is optimized. “Max” is slower.">
          <Segmented<PngOptimization>
            value={value.pngOptimization}
            onChange={(v) => set('pngOptimization', v)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'fast', label: 'Standard' },
              { value: 'max', label: 'Max' },
            ]}
          />
        </Field>
      )}
      {flattenTargets.length > 0 && (
        <div className="field">
          <Callout kind="neutral">{flattenTargets.map((f) => FORMAT_INFO[f].label).join(', ')} cannot store transparency. Transparent areas are filled with this color:</Callout>
          <ColorField value={value.flattenBackground} onChange={(v) => set('flattenBackground', v)} />
        </div>
      )}

      {isMobile() ? (
        <Field label="Save to">
          <div className="small muted">
            <Icon name="folder" size={12} style={{ verticalAlign: -2 }} /> {IOS_EXPORT_LOCATION}
          </div>
        </Field>
      ) : (
      <Field label="Save to">
        <Segmented<'source' | 'folder'>
          value={value.outputDir ? 'folder' : 'source'}
          onChange={async (v) => {
            if (v === 'source') set('outputDir', null);
            else {
              const dir = await pickOutputFolder();
              if (dir) set('outputDir', dir);
            }
          }}
          options={[
            { value: 'source', label: 'Next to original' },
            { value: 'folder', label: 'Choose folder…' },
          ]}
        />
        {value.outputDir && (
          <div className="row" style={{ alignItems: 'center', marginTop: 4 }}>
            <span className="small muted truncate" title={value.outputDir}>
              <Icon name="folder" size={12} style={{ verticalAlign: -2 }} /> {shortPath(value.outputDir, 3)}
            </span>
            <button
              className="btn ghost none small"
              onClick={async () => {
                const dir = await pickOutputFolder();
                if (dir) set('outputDir', dir);
              }}
            >
              Change…
            </button>
          </div>
        )}
      </Field>
      )}
      {!isMobile() && showPreserveStructure && value.outputDir && (
        <div className="field">
          <Checkbox checked={value.preserveStructure} onChange={(v) => set('preserveStructure', v)} label="Keep subfolder structure" title="Recreate the subfolders of an imported folder inside the output folder" />
        </div>
      )}

      <div className="row">
        <Field label="Suffix" info="Added to each file name. Tokens: {w} {h} (output size), {index}. Example: -{w}x{h}">
          <input className="input" value={value.suffix} onChange={(e) => set('suffix', e.target.value)} placeholder="-edited" spellCheck={false} />
        </Field>
        <Field label="Name pattern" info="Tokens: {name} original name, {suffix}, {w}, {h}, {index}. Default: {name}{suffix}">
          <input className="input mono" value={value.filenameTemplate} onChange={(e) => set('filenameTemplate', e.target.value)} placeholder="{name}{suffix}" spellCheck={false} />
        </Field>
      </div>
      {exampleName && (
        <div className="field-hint" style={{ marginTop: 4 }}>
          Example: <span className="mono">{exampleName}</span>
        </div>
      )}

      <Select<ConflictPolicy>
        label="If a file with the same name exists"
        value={value.conflict}
        onChange={(v) => set('conflict', v)}
        options={[
          { value: 'rename', label: 'Keep both (add -1, -2 …)' },
          { value: 'skip', label: 'Skip that file' },
          { value: 'replace', label: 'Replace the existing output' },
        ]}
        info="Original images are never replaced by this option. Replacing originals requires the separate setting below."
      />

      <div className="field">
        <Checkbox
          checked={value.allowSourceOverwrite}
          label={<span>Allow replacing original files</span>}
          title="Off by default. Only matters when the output name equals the original's name and folder."
          onChange={async (on) => {
            if (!on) return set('allowSourceOverwrite', false);
            const ok = await confirm({
              title: 'Allow replacing original images?',
              message: 'If an output file has exactly the same name and folder as its original, the original image will be permanently replaced. This cannot be undone. This permission applies only to this export and is not remembered.',
              confirmLabel: 'Allow Replacing',
              destructive: true,
            });
            if (ok) set('allowSourceOverwrite', true);
          }}
        />
      </div>
    </Section>
  );
}
