import { describe, expect, it } from 'vitest';
import {
  HEX_R,
  PLAYER_R,
  SIDES,
  advanceWalls,
  hits,
  laneDanger,
  roomToSpawn,
  sectorOf,
  spawnChunk,
  spawnPattern,
  spawnRing,
  spawnSpiral,
  travelTime,
  wallSpeed,
} from './walls';

/** A deterministic stand-in for Math.random. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('speed and travel', () => {
  it('ramps from 170 to 410 and saturates', () => {
    expect(wallSpeed(0)).toBe(170);
    expect(wallSpeed(34.3)).toBeCloseTo(410, 0);
    expect(wallSpeed(100)).toBe(410);
  });

  it('travelTime inverts the ramp: 170 px takes one second from t=0 only if the speed were constant', () => {
    // With acceleration the first 170 px take a bit under a second.
    const t = travelTime(170, 0);
    expect(t).toBeGreaterThan(0.95);
    expect(t).toBeLessThan(1);
    expect(travelTime(410, 40)).toBeCloseTo(1, 6);
  });
});

describe('patterns', () => {
  it('rings keep two gaps early and always leave at least one', () => {
    const early = spawnRing(500, 0, seq([0.9, 0.1, 0.5, 0.3]));
    expect(early.walls).toHaveLength(SIDES - 2);
    const late = spawnRing(500, 30, seq([0.9, 0.1, 0.3]));
    expect(late.walls).toHaveLength(SIDES - 1);
    for (const w of [...early.walls, ...late.walls]) expect(w.dist).toBe(500);
  });

  it('chunks are 3 or 4 adjacent walls; spirals step round at increasing distance', () => {
    const chunk = spawnChunk(500, seq([0.7, 0.5]));
    expect(chunk.walls).toHaveLength(4);
    expect(chunk.walls.map((w) => w.sec)).toEqual([3, 4, 5, 0]);
    const spiral = spawnSpiral(500, seq([0.2, 0.0, 0.5]));
    expect(spiral.walls).toHaveLength(5);
    expect(spiral.walls.map((w) => w.sec)).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < 5; i++) expect(spiral.walls[i].dist).toBeGreaterThan(spiral.walls[i - 1].dist);
  });

  it('the mix picks by the first draw', () => {
    expect(spawnPattern(500, 0, seq([0.1, 0.9, 0.1, 0.5, 0.5])).kind).toBe('ring');
    expect(spawnPattern(500, 0, seq([0.6, 0.1, 0.1])).kind).toBe('chunk');
    expect(spawnPattern(500, 0, seq([0.9, 0.1, 0.1, 0.5])).kind).toBe('spiral');
  });
});

describe('advance, spawn room, danger, hits', () => {
  it('moves walls inward and drops them past the centre', () => {
    const walls = [{ sec: 0, dist: 100, thick: 30 }, { sec: 1, dist: 40, thick: 30 }];
    const kept = advanceWalls(walls, 0.1, 0); // 17 px
    expect(kept).toHaveLength(2);
    expect(kept[0].dist).toBeCloseTo(83, 6);
    const gone = advanceWalls([{ sec: 0, dist: HEX_R - 40, thick: 30 }], 0.1, 0);
    expect(gone).toHaveLength(0);
  });

  it('roomToSpawn compares the outermost wall to the spawn radius minus spacing', () => {
    expect(roomToSpawn([], 500, 0)).toBe(true);
    expect(roomToSpawn([{ sec: 0, dist: 100, thick: 30 }], 500, 0)).toBe(true); // 130 < 170
    expect(roomToSpawn([{ sec: 0, dist: 300, thick: 30 }], 500, 0)).toBe(false); // 330 > 170
  });

  it('laneDanger ramps per lane over 250 px and ignores walls already past', () => {
    const out = new Array(SIDES).fill(0);
    const pressure = laneDanger([{ sec: 2, dist: PLAYER_R + 125, thick: 30 }, { sec: 4, dist: PLAYER_R - 100, thick: 30 }], out);
    expect(out[2]).toBeCloseTo(0.5, 6);
    expect(out[4]).toBe(0); // past the player
    expect(pressure).toBeCloseTo(0.5, 6);
  });

  it('hits only when the wall overlaps the player in the same sector', () => {
    expect(hits([{ sec: 3, dist: PLAYER_R - 10, thick: 30 }], 3)).toBe(true);
    expect(hits([{ sec: 3, dist: PLAYER_R - 10, thick: 30 }], 2)).toBe(false);
    expect(hits([{ sec: 3, dist: PLAYER_R + 50, thick: 30 }], 3)).toBe(false);
  });

  it('sectorOf wraps angles into 0..5', () => {
    expect(sectorOf(0)).toBe(0);
    expect(sectorOf(-0.1)).toBe(5);
    expect(sectorOf(Math.PI)).toBe(3);
  });
});
