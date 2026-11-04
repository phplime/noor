// TypeScript mirrors of the Rust engine types (crates/mackit-core).
// Keep these in sync with the serde shapes there.

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff' | 'gif';
export type OutputFormat = 'source' | 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff';
export type ConflictPolicy = 'skip' | 'rename' | 'replace';
export type PngOptimization = 'off' | 'fast' | 'max';

export type Anchor =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'centerLeft'
  | 'center'
  | 'centerRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight'
  | 'custom';

export interface Placement {
  anchor: Anchor;
  /** Custom only: fraction 0..1 of the free horizontal space. */
  x: number;
  y: number;
}

export type ResizeMode = 'fit' | 'canvas' | 'stretch' | 'percent' | 'within';
export type Filter = 'nearest' | 'bilinear' | 'catmullRom' | 'lanczos3';

export interface Background {
  color: string;
  transparent: boolean;
}

export interface ResizeSpec {
  mode: ResizeMode;
  width: number;
  height: number;
  percent: number;
  scaleImage: boolean;
  allowUpscale: boolean;
  placement: Placement;
  background: Background;
  filter: Filter;
}

export interface CropSpec {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WatermarkKind = 'logo' | 'text';
export type SizeUnit = 'pixels' | 'percentOfWidth';

export interface WatermarkSpec {
  kind: WatermarkKind;
  logoPath: string | null;
  logoSizeUnit: SizeUnit;
  logoPercent: number;
  logoWidth: number;
  logoHeight: number;
  keepAspect: boolean;
  text: string;
  fontSize: number;
  fontSizeUnit: SizeUnit;
  color: string;
  bold: boolean;
  opacity: number;
  placement: Placement;
  marginX: number;
  marginY: number;
  marginUnit: SizeUnit;
}

/** Clockwise rotation in 90° steps plus mirroring. */
export interface TransformSpec {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
}

/** Tone curve control points: [input, output], both 0..1. */
export type CurvePoints = [number, number][];

export interface Curves {
  rgb: CurvePoints;
  red: CurvePoints;
  green: CurvePoints;
  blue: CurvePoints;
}

/** -100..100 sliders (sharpness, vignette 0..100); 0 = no change. */
export interface AdjustSpec {
  autoEnhance: boolean;
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  sharpness: number;
  vignette: number;
  curves: Curves;
}

export type Operation =
  | ({ type: 'crop' } & CropSpec)
  | ({ type: 'resize' } & ResizeSpec)
  | ({ type: 'watermark' } & WatermarkSpec)
  | ({ type: 'transform' } & TransformSpec)
  | ({ type: 'adjust' } & AdjustSpec)
  | ({ type: 'background' } & BackgroundSpec);

export type SubjectMode = 'auto' | 'subjects' | 'people' | 'graphic';
export type BgMode = 'transparent' | 'color' | 'blur' | 'grayscale';

/** Brush stroke in normalised image coordinates (0–1). */
export interface MaskStroke {
  keep: boolean;
  /** Radius as a fraction of the image's shorter side. */
  radius: number;
  points: [number, number][];
}

export interface BackgroundSpec {
  detect: boolean;
  subject: SubjectMode;
  /** Clicked points (0–1) choosing which detected subjects to keep; empty = all. */
  picks: [number, number][];
  strokes: MaskStroke[];
  invert: boolean;
  refine: boolean;
  /** Logo / graphic mode: minimum difference from the background colour, in %. */
  tolerance: number;
  /** Grow (+) / shrink (−), 1/1000 of the shorter side. */
  edge: number;
  /** Edge softness, 1/1000 of the shorter side. */
  feather: number;
  mode: BgMode;
  color: string;
  /** 0–100 */
  blur: number;
  lens: boolean;
  /** 0–100 */
  highlights: number;
}

export interface MarkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a watermark sits and the area it can be dragged within (logical px). */
export interface MarkLayout {
  rect: MarkRect;
  area: MarkRect;
}

export interface ExportOptions {
  outputDir: string | null;
  format: OutputFormat;
  quality: number;
  webpLossless: boolean;
  pngOptimization: PngOptimization;
  flattenBackground: string;
  filenameTemplate: string;
  suffix: string;
  conflict: ConflictPolicy;
  preserveStructure: boolean;
  allowSourceOverwrite: boolean;
}

export interface CanvasPlan {
  canvasW: number;
  canvasH: number;
  imageX: number;
  imageY: number;
  imageW: number;
  imageH: number;
  hasPadding: boolean;
  distorted: boolean;
}

export interface PipelinePlan {
  sourceW: number;
  sourceH: number;
  outputW: number;
  outputH: number;
  resize: CanvasPlan | null;
  cropped: boolean;
  warnings: string[];
}

export interface PreviewResult {
  dataUrl: string;
  previewW: number;
  previewH: number;
  plan: PipelinePlan;
  hasAlpha: boolean;
  marks: MarkLayout[];
}

export interface Thumbnail {
  dataUrl: string;
  width: number;
  height: number;
  hasAlpha: boolean;
}

export interface ScannedFile {
  path: string;
  name: string;
  relDir: string | null;
  size: number;
  width: number;
  height: number;
  format: ImageFormat;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ScanResult {
  files: ScannedFile[];
  skipped: SkippedFile[];
  truncated: boolean;
}

export interface EngineError {
  code: string;
  message: string;
  details?: Record<string, number>;
}

export interface BatchItem {
  path: string;
  relDir: string | null;
  /** Per-image operations replacing the job's (e.g. subjects picked on this photo). */
  operations?: Operation[];
}

export interface BatchJob {
  items: BatchItem[];
  operations: Operation[];
  export: ExportOptions;
}

export type ItemStatus = 'processing' | 'done' | 'skipped' | 'failed' | 'cancelled';

export interface ItemUpdate {
  index: number;
  path: string;
  status: ItemStatus;
  outputPath: string | null;
  outputW: number | null;
  outputH: number | null;
  outputFormat: ImageFormat | null;
  inputBytes: number;
  outputBytes: number | null;
  renamed: boolean;
  replaced: boolean;
  message: string | null;
  error: EngineError | null;
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  cancelled: number;
  wasCancelled: boolean;
  inputBytes: number;
  outputBytes: number;
  elapsedMs: number;
}

export type BatchEvent = ({ kind: 'item' } & ItemUpdate) | ({ kind: 'finished' } & BatchSummary);

export interface PreflightItem {
  index: number;
  path: string;
  outputPath: string | null;
  outputW: number;
  outputH: number;
  outputFormat: ImageFormat | null;
  exists: boolean;
  isSource: boolean;
  deduplicated: boolean;
  error: EngineError | null;
}

export interface Preflight {
  items: PreflightItem[];
  conflicts: number;
  sourceOverwrites: number;
  errors: number;
}

export interface Measured {
  bytes: number;
  inputBytes: number;
  format: ImageFormat;
  width: number;
  height: number;
}
