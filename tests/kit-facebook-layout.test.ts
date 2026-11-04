import { describe, expect, it } from 'vitest';
import { backgroundFontSize, fbGrid, lineText, wrapText } from '../src/kit/tools/facebook-post/layout';

const mono = (s: string) => [...s].length * 10;

describe('facebook photo grid', () => {
  const land = { w: 1600, h: 900 };
  const port = { w: 900, h: 1600 };
  const sq = { w: 1000, h: 1000 };

  it('keeps a single photo proportional within limits', () => {
    expect(fbGrid([land], 500).height).toBe(Math.round(500 * (900 / 1600)));
    expect(fbGrid([port], 500).height).toBe(625); // clamped to 4:5
  });

  it('tiles stay inside the grid and never overlap', () => {
    for (const set of [[land, land], [port, port], [land, sq, sq], [port, sq, sq, sq], [sq, sq, sq, sq], Array(7).fill(sq)]) {
      const g = fbGrid(set, 500);
      expect(g.tiles.length).toBe(Math.min(set.length, 5));
      for (const t of g.tiles) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.w).toBeLessThanOrEqual(500);
        expect(t.y + t.h).toBeLessThanOrEqual(g.height);
      }
      for (const a of g.tiles)
        for (const b of g.tiles) {
          if (a === b) continue;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
    }
  });

  it('shows +N for hidden photos', () => {
    const g = fbGrid(Array(8).fill(sq), 500);
    expect(g.tiles[4].more).toBe(3);
    expect(fbGrid(Array(5).fill(sq), 500).tiles[4].more).toBe(0);
  });
});

describe('text wrapping', () => {
  it('wraps on words, keeps newlines and blank lines', () => {
    const lines = wrapText('hello world foo\n\nbar', 110, mono);
    expect(lines.map(lineText)).toEqual(['hello world', 'foo', '', 'bar']);
  });

  it('marks hashtags and mentions as links', () => {
    const [line] = wrapText('Hi @sam see #MacKit', 1000, mono);
    expect(line.filter((t) => t.link).map((t) => t.text)).toEqual(['@sam', '#MacKit']);
  });

  it('breaks very long words without splitting emoji', () => {
    const lines = wrapText('👍👍👍👍👍👍', 30, mono);
    for (const l of lines) expect(lineText(l)).toMatch(/^(👍)+$/u);
    expect(lines.map(lineText).join('')).toBe('👍👍👍👍👍👍');
  });

  it('picks smaller background fonts for longer text', () => {
    expect(backgroundFontSize('short')).toBeGreaterThan(backgroundFontSize('x'.repeat(120)));
  });
});
