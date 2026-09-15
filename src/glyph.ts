// A name becomes a face nobody chose: hash the name, seed an elementary
// cellular automaton with the bits, run it for a few rows, mirror the result.
// Deterministic everywhere, so the pad and the projector agree without
// sending pixels; only the name travels.

export const GLYPH_SIZE = 16;
/** Rules that draw something structured at 16 cells: not all-dead, not noise, not stripes. */
const RULES = [30, 45, 73, 90, 110, 150, 105, 22] as const;

/** FNV-1a, 32-bit; two passes with different seeds give 64 bits of material. */
function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Glyph {
  /** GLYPH_SIZE rows of GLYPH_SIZE booleans. */
  cells: boolean[][];
  rule: number;
  hue: number;
}

/** The normalized identity: case and surrounding space do not make a different person. */
export function glyphKey(name: string): string {
  return name.trim().toLowerCase();
}

export function glyph(name: string): Glyph {
  const key = glyphKey(name) || '?';
  const a = fnv1a(key, 0x811c9dc5);
  const b = fnv1a(key, 0x9747b28c);
  const rule = RULES[a % RULES.length];
  const hue = b % 360;
  // Half a row from the hash bits, mirrored, so the glyph reads as a face rather than a strip.
  const half = GLYPH_SIZE / 2;
  let row: boolean[] = [];
  for (let i = 0; i < half; i++) row.push(((a >>> (i + 3)) & 1) === 1);
  // A dead first row draws nothing; light one cell in that case.
  if (!row.some(Boolean)) row[half - 1] = true;
  row = row.concat(row.slice().reverse());

  const cells: boolean[][] = [row];
  for (let r = 1; r < GLYPH_SIZE; r++) {
    const prev = cells[r - 1];
    const next: boolean[] = new Array(GLYPH_SIZE);
    for (let i = 0; i < GLYPH_SIZE; i++) {
      const l = prev[(i - 1 + GLYPH_SIZE) % GLYPH_SIZE] ? 4 : 0;
      const c = prev[i] ? 2 : 0;
      const rr = prev[(i + 1) % GLYPH_SIZE] ? 1 : 0;
      next[i] = ((rule >> (l | c | rr)) & 1) === 1;
    }
    cells.push(next);
  }
  return { cells, rule, hue };
}

/** An inline SVG of the glyph; `size` is the rendered edge in CSS pixels. */
export function glyphSvg(name: string, size = 48, color = 'currentColor'): string {
  const g = glyph(name);
  const rects: string[] = [];
  for (let r = 0; r < GLYPH_SIZE; r++) {
    for (let c = 0; c < GLYPH_SIZE; c++) {
      if (g.cells[r][c]) rects.push(`<rect x="${c}" y="${r}" width="1" height="1"/>`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}" width="${size}" height="${size}" ` +
    `shape-rendering="crispEdges" fill="${color}" role="img" aria-label="glyph">${rects.join('')}</svg>`
  );
}

/** The player's colour, from the same hash. */
export function glyphColor(name: string, light = 62): string {
  return `hsl(${glyph(name).hue}, 85%, ${light}%)`;
}
