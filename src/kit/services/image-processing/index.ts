import { call } from '../ipc';
import type {
  Anchor,
  ExportOptions,
  Measured,
  CropSpec,
  Operation,
  PipelinePlan,
  Placement,
  PreviewResult,
  ResizeSpec,
  Thumbnail,
  WatermarkSpec,
} from '../../types/engine';

/** Render a preview of `operations` applied to `path` with the real engine. */
export function renderPreview(path: string, operations: Operation[], maxSide = 1400): Promise<PreviewResult> {
  return call<PreviewResult>('render_preview', { request: { path, operations, maxSide } });
}

/** Encode the selected image in memory with real export settings; returns the measured size. */
export function measureOutput(path: string, operations: Operation[], exportOptions: ExportOptions): Promise<Measured> {
  return call<Measured>('measure_output', { request: { path, operations, export: exportOptions } });
}

/** Output dimensions without decoding any pixels. */
export function planOperations(width: number, height: number, operations: Operation[]): Promise<PipelinePlan> {
  return call<PipelinePlan>('plan_operations', { width, height, operations });
}

const thumbCache = new Map<string, Promise<Thumbnail>>();

/** Cached thumbnail data URL for an image file. */
export function getThumbnail(path: string, size = 160): Promise<Thumbnail> {
  const key = `${size}:${path}`;
  let p = thumbCache.get(key);
  if (!p) {
    p = call<Thumbnail>('thumbnail', { path, size });
    p.catch(() => thumbCache.delete(key));
    thumbCache.set(key, p);
    if (thumbCache.size > 600) {
      const first = thumbCache.keys().next().value;
      if (first) thumbCache.delete(first);
    }
  }
  return p;
}

export function forgetThumbnails(): void {
  thumbCache.clear();
}

// ---- Operation builders (single place that knows the wire format) ----

export const placementAt = (anchor: Anchor, x = 0.5, y = 0.5): Placement => ({ anchor, x, y });

export const DEFAULT_RESIZE: ResizeSpec = {
  mode: 'fit',
  width: 1200,
  height: 628,
  percent: 100,
  scaleImage: false,
  allowUpscale: true,
  placement: placementAt('center'),
  background: { color: '#ffffff', transparent: false },
  filter: 'lanczos3',
};

export const DEFAULT_WATERMARK: WatermarkSpec = {
  kind: 'logo',
  logoPath: null,
  logoSizeUnit: 'percentOfWidth',
  logoPercent: 20,
  logoWidth: 200,
  logoHeight: 200,
  keepAspect: true,
  text: '© Your Name',
  fontSize: 4,
  fontSizeUnit: 'percentOfWidth',
  color: '#ffffff',
  bold: true,
  opacity: 0.8,
  placement: placementAt('bottomRight'),
  marginX: 2,
  marginY: 2,
  marginUnit: 'percentOfWidth',
};

export const resizeOp = (spec: ResizeSpec): Operation => ({ type: 'resize', ...spec });
export const cropOp = (c: CropSpec): Operation => ({ type: 'crop', ...c });
export const watermarkOp = (w: WatermarkSpec): Operation => ({ type: 'watermark', ...w });

/** Plain-language explanation of each resize mode (shared by all tools). */
export const RESIZE_MODE_INFO: Record<ResizeSpec['mode'], { label: string; short: string; help: string }> = {
  fit: {
    label: 'Fit / Contain',
    short: 'Whole image, scaled to fit, padded',
    help: 'Scales the entire image proportionally until it fits inside the target size, then fills the unused space with the background. Nothing is cut off and nothing is stretched.',
  },
  canvas: {
    label: 'Canvas Resize / Padding',
    short: 'Change the canvas, add space around the image',
    help: 'Changes the canvas to the exact size and places the whole image on it. By default the image keeps its original pixel size. If the canvas is smaller than the image, Noor refuses instead of cropping.',
  },
  stretch: {
    label: 'Stretch',
    short: 'Exact size, aspect ratio not kept',
    help: 'Resizes the whole image to exactly the requested width and height. If the proportions differ, the image will look squashed or stretched. Nothing is cut off.',
  },
  within: {
    label: 'Fit within (no padding)',
    short: 'Shrink to fit a maximum size',
    help: 'Scales the whole image proportionally so it fits inside the width and height. The output takes the scaled image’s own size — no padding is added and nothing is cut off.',
  },
  percent: {
    label: 'Scale by %',
    short: 'Resize the whole image by a percentage',
    help: 'Scales the whole image by a percentage, keeping its proportions.',
  },
};
