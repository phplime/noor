import type { ReactNode } from 'react';
import { useApp } from '../../app/AppContext';
import { AlignmentGrid } from '../../components/AlignmentGrid';
import { Checkbox, ColorField, NumberField, Segmented, Select, Slider } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { OUTPUT_FORMATS, pickOutputFolder } from '../../services/file-export';
import { forgetThumbnails } from '../../services/image-processing';
import { call } from '../../services/ipc';
import type { ConflictPolicy, OutputFormat, ResizeMode } from '../../types/engine';
import type { Theme } from '../../types/settings';
import { parseRatio } from '../../utils/cropMath';
import { shortPath } from '../../utils/format';

function Row({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="label">{label}</div>
        {help && <div className="help">{help}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

const RATIOS = ['free', '1:1', '4:3', '3:2', '16:9', '9:16', '3:4', '2:3'];

export default function SettingsPage() {
  const { settings: s, updateSettings: update, resetSettings, confirm, appInfo } = useApp();
  const customRatio = !RATIOS.includes(s.defaultAspectRatio);

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="card">
          <div className="card-header">
            <h2>Appearance</h2>
          </div>
          <div className="card-body">
            <Row label="Theme">
              <Segmented<Theme>
                value={s.theme}
                onChange={(theme) => update({ theme })}
                options={[
                  { value: 'light', label: 'Light', icon: 'sun' },
                  { value: 'dark', label: 'Dark', icon: 'moon' },
                  { value: 'system', label: 'System', icon: 'monitor' },
                ]}
              />
            </Row>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Export defaults</h2>
            <p>Used by every image tool when it opens. Each export can still be changed individually.</p>
          </div>
          <div className="card-body">
            <Row label="Output folder" help={s.defaultOutputDir ? shortPath(s.defaultOutputDir, 3) : 'Next to each original image'}>
              <div className="btn-row">
                <button
                  className="btn"
                  onClick={async () => {
                    const dir = await pickOutputFolder();
                    if (dir) await update({ defaultOutputDir: dir });
                  }}
                >
                  <Icon name="folder" /> Choose…
                </button>
                {s.defaultOutputDir && (
                  <button className="btn ghost" onClick={() => update({ defaultOutputDir: null })}>
                    Use original folder
                  </button>
                )}
              </div>
            </Row>
            <Row label="Output format">
              <Select<OutputFormat> value={s.defaultOutputFormat} onChange={(v) => update({ defaultOutputFormat: v })} options={OUTPUT_FORMATS} />
            </Row>
            <Row label="Image quality" help="JPEG and lossy WebP">
              <Slider value={s.defaultQuality} min={1} max={100} onChange={(v) => update({ defaultQuality: v })} ariaLabel="Default quality" />
            </Row>
            <Row label="Filename suffix" help="Leave empty to use each tool’s own suffix (-cropped, -watermarked, -590x300 …).">
              <input className="input" value={s.defaultSuffix} placeholder="Tool default" onChange={(e) => update({ defaultSuffix: e.target.value })} spellCheck={false} />
            </Row>
            <Row label="When a file already exists">
              <Select<ConflictPolicy>
                value={s.defaultConflict}
                onChange={(v) => update({ defaultConflict: v })}
                options={[
                  { value: 'rename', label: 'Keep both (add -1, -2 …)' },
                  { value: 'skip', label: 'Skip' },
                  { value: 'replace', label: 'Replace the existing output' },
                ]}
              />
            </Row>
            <Row label="Ask before writing over existing files">
              <Checkbox checked={s.confirmOverwrite} onChange={(v) => update({ confirmOverwrite: v })} label="Confirm" />
            </Row>
            <Row label="Remember last-used export settings" help="Per tool. “Allow replacing originals” is never remembered.">
              <Checkbox checked={s.rememberLastExport} onChange={(v) => update({ rememberLastExport: v, lastExport: v ? s.lastExport : {} })} label="Remember" />
            </Row>
            <Row label="Include subfolders when adding a folder">
              <Checkbox checked={s.includeSubfolders} onChange={(v) => update({ includeSubfolders: v })} label="Include" />
            </Row>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Tool defaults</h2>
          </div>
          <div className="card-body">
            <Row label="Resize mode">
              <Select<ResizeMode>
                value={s.defaultResizeMode}
                onChange={(v) => update({ defaultResizeMode: v })}
                options={[
                  { value: 'fit', label: 'Fit / Contain' },
                  { value: 'canvas', label: 'Canvas Resize / Padding' },
                  { value: 'stretch', label: 'Stretch' },
                  { value: 'percent', label: 'Scale by %' },
                ]}
              />
            </Row>
            <Row label="Background color" help="Padding and transparency fill">
              <ColorField value={s.defaultBackground} onChange={(v) => update({ defaultBackground: v })} swatches={false} />
            </Row>
            <Row label="Crop aspect ratio">
              <div className="row" style={{ alignItems: 'center' }}>
                <Select<string>
                  value={customRatio ? 'custom' : s.defaultAspectRatio}
                  onChange={(v) => update({ defaultAspectRatio: v === 'custom' ? '590:300' : v })}
                  options={[...RATIOS.map((r) => ({ value: r, label: r === 'free' ? 'Freeform' : r })), { value: 'custom', label: 'Custom…' }]}
                />
                {customRatio && (
                  <input
                    className={`input mono${parseRatio(s.defaultAspectRatio) ? '' : ' invalid'}`}
                    defaultValue={s.defaultAspectRatio}
                    onBlur={(e) => parseRatio(e.target.value) && update({ defaultAspectRatio: e.target.value.trim() })}
                    aria-label="Custom ratio, e.g. 590:300"
                  />
                )}
              </div>
            </Row>
            <Row label="Watermark position">
              <AlignmentGrid value={{ anchor: s.defaultWatermarkAnchor, x: 0.5, y: 0.5 }} onChange={(p) => update({ defaultWatermarkAnchor: p.anchor })} allowCustom={false} />
            </Row>
            <Row label="Watermark opacity">
              <Slider value={Math.round(s.defaultWatermarkOpacity * 100)} min={0} max={100} onChange={(v) => update({ defaultWatermarkOpacity: v / 100 })} format={(v) => `${v}%`} ariaLabel="Default watermark opacity" />
            </Row>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Performance &amp; limits</h2>
            <p>Protect your Mac from images that would need too much memory.</p>
          </div>
          <div className="card-body">
            <Row label="Maximum width or height" help="Inputs and outputs larger than this are refused.">
              <NumberField value={s.limits.maxDimension} unit="px" min={1000} max={65000} onChange={(v) => update({ limits: { ...s.limits, maxDimension: v } })} ariaLabel="Maximum dimension" />
            </Row>
            <Row label="Maximum image size" help="Megapixels (width × height ÷ 1,000,000). 150 MP needs about 600 MB of memory.">
              <NumberField value={s.limits.maxMegapixels} unit="MP" min={10} max={1000} onChange={(v) => update({ limits: { ...s.limits, maxMegapixels: v } })} ariaLabel="Maximum megapixels" />
            </Row>
            <Row label="Images processed in parallel" help="Higher is faster on many-core Macs but uses more memory.">
              <NumberField value={s.concurrency} min={1} max={8} onChange={(v) => update({ concurrency: v })} ariaLabel="Parallel images" />
            </Row>
            <Row label="Preview cache">
              <button
                className="btn"
                onClick={async () => {
                  await call('clear_preview_cache');
                  forgetThumbnails();
                }}
              >
                Clear cached previews
              </button>
            </Row>
          </div>
        </div>

        <div className="card">
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Reset settings</div>
              <div className="small muted">Restore all settings above to their defaults. Saved in {appInfo.settingsPath ? shortPath(appInfo.settingsPath, 3) : 'the app’s config folder'}.</div>
            </div>
            <button
              className="btn danger"
              onClick={async () => {
                const ok = await confirm({ title: 'Reset all settings?', message: 'All preferences return to their defaults. Your images are not affected.', confirmLabel: 'Reset', destructive: true });
                if (ok) await resetSettings();
              }}
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
