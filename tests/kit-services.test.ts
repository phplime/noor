import { describe, expect, it } from 'vitest';
import { defaultExportOptions, previewFilename, resolveFormat } from '../src/kit/services/file-export';
import { mergeQueue } from '../src/kit/services/file-import';
import { AppError } from '../src/kit/services/ipc';
import { DEFAULT_SETTINGS } from '../src/kit/types/settings';
import type { ScannedFile } from '../src/kit/types/engine';
import { basename, formatBytes, formatDims, gcd, parsePositiveInt, ratioLabel, shortPath, sizeChange, stem } from '../src/kit/utils/format';

describe('filename preview (mirrors the Rust engine)', () => {
  it('matches the spec naming examples', () => {
    expect(previewFilename('{name}{suffix}', '-resized', 'photo', 590, 300, 'png')).toBe('photo-resized.png');
    expect(previewFilename('{name}{suffix}', '-watermarked', 'photo', 1, 1, 'jpg')).toBe('photo-watermarked.jpg');
    expect(previewFilename('{name}{suffix}', '-cropped', 'photo', 1, 1, 'webp')).toBe('photo-cropped.webp');
    expect(previewFilename('{name}{suffix}', '-{w}x{h}', 'photo', 590, 300, 'png')).toBe('photo-590x300.png');
    expect(previewFilename('', '-x', 'photo', 1, 1, 'jpeg')).toBe('photo-x.jpg');
  });
  it('removes path separators', () => {
    expect(previewFilename('../{name}', '', 'a', 1, 1, 'png')).toBe('-a.png');
    expect(previewFilename('a/b:c', '', 'x', 1, 1, 'png')).toBe('a-b-c.png');
  });
});

describe('formats and export defaults', () => {
  it('resolves "same as original"', () => {
    expect(resolveFormat('source', 'webp')).toBe('webp');
    expect(resolveFormat('source', 'gif')).toBe('png');
    expect(resolveFormat('jpeg', 'png')).toBe('jpeg');
  });
  it('builds defaults from settings and never remembers source overwrite', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      defaultQuality: 70,
      lastExport: { crop: { ...defaultExportOptions(DEFAULT_SETTINGS, 'crop', '-c'), suffix: '-mine', allowSourceOverwrite: true } },
    };
    const d = defaultExportOptions(s, 'resize', '-r');
    expect(d.quality).toBe(70);
    expect(d.suffix).toBe('-r');
    expect(d.allowSourceOverwrite).toBe(false);
    const remembered = defaultExportOptions(s, 'crop', '-c');
    expect(remembered.suffix).toBe('-mine');
    expect(remembered.allowSourceOverwrite).toBe(false);
    const off = defaultExportOptions({ ...s, rememberLastExport: false }, 'crop', '-c');
    expect(off.suffix).toBe('-c');
  });
});

describe('import queue', () => {
  const f = (path: string): ScannedFile => ({ path, name: basename(path), relDir: null, size: 1, width: 1, height: 1, format: 'png' });
  it('deduplicates by path', () => {
    const { queue, added } = mergeQueue([f('/a.png')], [f('/a.png'), f('/b.png')]);
    expect(queue.map((x) => x.path)).toEqual(['/a.png', '/b.png']);
    expect(added).toBe(1);
  });
});

describe('errors', () => {
  it('explains plugin failures in a plain browser tab', () => {
    const e = AppError.from(new TypeError("Cannot read properties of undefined (reading 'invoke')"));
    expect(e.code).toBe('no_runtime');
    expect(AppError.from(new TypeError('something else')).code).toBe('error');
  });

  it('normalises engine payloads and strings', () => {
    const e = AppError.from({ code: 'does_not_fit', message: 'nope', details: { srcW: 1 } });
    expect(e.code).toBe('does_not_fit');
    expect(e.details?.srcW).toBe(1);
    expect(AppError.from('boom').message).toBe('boom');
    expect(AppError.from(new Error('x')).message).toBe('x');
    expect(AppError.from(42).code).toBe('error');
  });
});

describe('format utils', () => {
  it('formats sizes and changes honestly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(null)).toBe('—');
    expect(sizeChange(1000, 580)).toBe('−42%');
    expect(sizeChange(1000, 1030)).toBe('+3%');
    expect(sizeChange(0, 10)).toBe('—');
  });
  it('dimensions and ratios', () => {
    expect(formatDims(590, 300)).toBe('590 × 300');
    expect(gcd(1200, 628)).toBe(4);
    expect(ratioLabel(1200, 628)).toBe('300:157');
    expect(ratioLabel(1920, 1080)).toBe('16:9');
  });
  it('paths', () => {
    expect(stem('/x/photo.final.jpeg')).toBe('photo.final');
    expect(shortPath('/Users/naz/Pictures/a/b/c/photo.png')).toBe('~/…/c/photo.png');
  });
  it('positive integers', () => {
    expect(parsePositiveInt('590')).toBe(590);
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('12.5')).toBeNull();
    expect(parsePositiveInt('-3')).toBeNull();
    expect(parsePositiveInt('99999999')).toBeNull();
  });
});

describe('settings suffix', () => {
  it('uses the tool suffix unless a global one is set', () => {
    expect(defaultExportOptions(DEFAULT_SETTINGS, 'crop', '-cropped').suffix).toBe('-cropped');
    expect(defaultExportOptions({ ...DEFAULT_SETTINGS, defaultSuffix: '-web' }, 'crop', '-cropped').suffix).toBe('-web');
  });
});
