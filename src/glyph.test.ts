import { describe, expect, it } from 'vitest';
import { GLYPH_SIZE, glyph, glyphColor, glyphKey, glyphSvg } from './glyph';

describe('glyph', () => {
  it('is deterministic and insensitive to case and surrounding space', () => {
    const a = glyph('Eugene');
    const b = glyph('  eugene ');
    expect(a).toEqual(b);
    expect(glyphKey(' Eugene ')).toBe('eugene');
  });

  it('differs between names that differ by one letter', () => {
    const a = glyph('eugene');
    const b = glyph('eugena');
    expect(a.cells).not.toEqual(b.cells);
  });

  it('is a full square, mirrored on the first row, never blank', () => {
    for (const name of ['', 'a', 'zz', 'fractal tech', '🍟']) {
      const g = glyph(name);
      expect(g.cells).toHaveLength(GLYPH_SIZE);
      for (const row of g.cells) expect(row).toHaveLength(GLYPH_SIZE);
      const first = g.cells[0];
      for (let i = 0; i < GLYPH_SIZE / 2; i++) expect(first[i]).toBe(first[GLYPH_SIZE - 1 - i]);
      expect(g.cells.flat().some(Boolean)).toBe(true);
    }
  });

  it('renders an SVG with one rect per live cell and a colour from the hash', () => {
    const g = glyph('eugene');
    const live = g.cells.flat().filter(Boolean).length;
    const svg = glyphSvg('eugene', 32, '#fff');
    expect(svg.match(/<rect /g)).toHaveLength(live);
    expect(svg).toContain('width="32"');
    expect(glyphColor('eugene')).toMatch(/^hsl\(\d+, 85%, 62%\)$/);
    expect(glyphColor('eugene')).toBe(glyphColor('EUGENE'));
  });
});
