import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Callout, Segmented } from './Field';
import { getThumbnail } from '../services/image-processing';
import { usePreview } from '../hooks/usePreview';
import { useShortcut } from '../hooks/useShortcut';
import type { AppError } from '../services/ipc';
import type { Operation, PreviewResult, ScannedFile } from '../types/engine';
import { formatDims } from '../utils/format';

type Zoom = number | 'fit';

export function useZoom(contentW: number, contentH: number) {
  // A callback ref, so measuring starts whenever the viewport mounts (e.g. after the first photo is added).
  const [el, viewport] = useState<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const pad = el.clientWidth < 500 ? 28 : 56;
      const s = Math.min((el.clientWidth - pad) / Math.max(contentW, 1), (el.clientHeight - pad) / Math.max(contentH, 1));
      setFitScale(Math.max(0.01, Math.min(s, 4)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, contentW, contentH]);
  const scale = zoom === 'fit' ? Math.min(fitScale, 1) : zoom;
  const steps = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
  const zoomIn = () => setZoom(steps.find((s) => s > scale + 1e-6) ?? 8);
  const zoomOut = () => setZoom([...steps].reverse().find((s) => s < scale - 1e-6) ?? 0.05);
  return { viewport, scale, zoom, setZoom, zoomIn, zoomOut, fit: () => setZoom('fit') };
}

export function ZoomControls({ z }: { z: ReturnType<typeof useZoom> }) {
  useShortcut('mod+=', z.zoomIn);
  useShortcut('mod+-', z.zoomOut);
  useShortcut('mod+0', z.fit);
  return (
    <span className="zoom-controls">
      <button className="btn ghost icon" title="Zoom out (⌘−)" onClick={z.zoomOut}>
        <Icon name="zoomOut" />
      </button>
      <span className="mono small zoom-pct" style={{ width: 44, textAlign: 'center' }}>
        {Math.round(z.scale * 100)}%
      </span>
      <button className="btn ghost icon" title="Zoom in (⌘+)" onClick={z.zoomIn}>
        <Icon name="zoomIn" />
      </button>
      <button className={`btn ghost zoom-fit${z.zoom === 'fit' ? ' active' : ''}`} title="Fit to window (⌘0)" onClick={z.fit}>
        <Icon name="fit" /> <span className="zoom-label">Fit</span>
      </button>
      <button className="btn ghost zoom-100" title="Actual pixels" onClick={() => z.setZoom(1)}>
        100%
      </button>
    </span>
  );
}

interface PreviewStageProps {
  file: ScannedFile;
  operations: Operation[];
  /** Draw the canvas / image / padding overlay (resize tools). */
  showLayout?: boolean;
  renderError?: (e: AppError) => ReactNode;
  extraBar?: ReactNode;
  onResult?: (r: PreviewResult | null) => void;
  /** Interactive layer drawn over the result (e.g. draggable watermark). */
  overlay?: (ctx: { scale: number; result: PreviewResult }) => ReactNode;
}

/** Accurate preview of the export (rendered by the engine) with zoom and before/after. */
export function PreviewStage({ file, operations, showLayout, renderError, extraBar, onResult, overlay }: PreviewStageProps) {
  const { result, error, loading } = usePreview(file.path, operations);
  const [view, setView] = useState<'result' | 'compare'>('result');
  const [original, setOriginal] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const outW = result?.plan.outputW ?? file.width;
  const outH = result?.plan.outputH ?? file.height;
  const z = useZoom(view === 'compare' ? outW * 2 + 40 : outW, outH);

  useEffect(() => onResult?.(result), [result, onResult]);
  useEffect(() => {
    if (view !== 'compare') return;
    let live = true;
    getThumbnail(file.path, 1400)
      .then((t) => live && setOriginal(t.dataUrl))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [view, file.path]);

  const plan = result?.plan;
  const r = plan?.resize;
  const s = z.scale;
  const layoutVisible = showLayout && showOverlay && r && plan && plan.outputW === r.canvasW;

  return (
    <div className="stage">
      <div className="stage-bar">
        <Segmented<'result' | 'compare'>
          value={view}
          onChange={setView}
          ariaLabel="Preview mode"
          options={[
            { value: 'result', label: 'Result' },
            { value: 'compare', label: 'Before / After', icon: 'compare' },
          ]}
        />
        {showLayout && (
          <label className="checkbox small" title="Outline the image area and shade the added padding">
            <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} /> Guides
          </label>
        )}
        {extraBar}
        <span className="spacer" />
        <ZoomControls z={z} />
      </div>
      <div className="stage-viewport" ref={z.viewport}>
        {error ? (
          <div style={{ maxWidth: 480 }}>{renderError ? renderError(error) : <Callout kind="danger">{error.message}</Callout>}</div>
        ) : !result ? (
          <div className="spinner" aria-label="Rendering preview" />
        ) : view === 'compare' ? (
          <div className="compare" style={{ width: (outW * 2 + 40) * s }}>
            <figure>
              <div
                className="stage-canvas checker"
                style={(() => {
                  const b = Math.min((outW * s) / file.width, (outH * s) / file.height);
                  return { width: file.width * b, height: file.height * b };
                })()}
              >
                {original && <img src={original} alt="Original" draggable={false} />}
              </div>
              <figcaption>Before · {formatDims(file.width, file.height)}</figcaption>
            </figure>
            <figure>
              <div className={`stage-canvas${result.hasAlpha ? ' checker' : ''}`} style={{ width: outW * s, height: outH * s }}>
                <img src={result.dataUrl} alt="Result" draggable={false} />
              </div>
              <figcaption>After · {formatDims(outW, outH)}</figcaption>
            </figure>
          </div>
        ) : (
          <div className={`stage-canvas${result.hasAlpha ? ' checker' : ''}`} style={{ width: outW * s, height: outH * s }}>
            <img src={result.dataUrl} alt="Preview of the exported image" draggable={false} />
            {layoutVisible && r && <LayoutOverlay r={r} s={s} />}
            {showLayout && <div className="outline" />}
            {overlay?.({ scale: s, result })}
          </div>
        )}
      </div>
      {result && !error && (
        <div className="stage-status">
          {loading && <span className="spinner" />}
          <span>
            Output <strong className="mono">{formatDims(outW, outH)}</strong> px
          </span>
        </div>
      )}
    </div>
  );
}

function LayoutOverlay({ r, s }: { r: NonNullable<PreviewResult['plan']['resize']>; s: number }) {
  if (!r.hasPadding) return null;
  const x = r.imageX * s;
  const y = r.imageY * s;
  const w = r.imageW * s;
  const h = r.imageH * s;
  const W = r.canvasW * s;
  const H = r.canvasH * s;
  const shades = [
    { left: 0, top: 0, width: W, height: y },
    { left: 0, top: y + h, width: W, height: H - y - h },
    { left: 0, top: y, width: x, height: h },
    { left: x + w, top: y, width: W - x - w, height: h },
  ].filter((b) => b.width > 0.5 && b.height > 0.5);
  return (
    <>
      {shades.map((b, i) => (
        <div key={i} className="padding-shade" style={b} />
      ))}
      <div className="image-rect" style={{ left: x, top: y, width: w, height: h }} />
    </>
  );
}

export function LayoutLegend() {
  return (
    <div className="legend">
      <span>
        <span className="swatch" style={{ outline: '1px dashed var(--text-secondary)' }} />
        Image
      </span>
      <span>
        <span className="swatch" style={{ background: 'repeating-linear-gradient(45deg, var(--padding-hatch) 0 3px, transparent 3px 6px)', border: '1px solid var(--border)' }} />
        Added padding
      </span>
      <span>
        <span className="swatch" style={{ outline: '1px solid var(--accent)' }} />
        Output canvas
      </span>
    </div>
  );
}
