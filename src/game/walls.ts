// The field, pure: walls that collapse inward, the patterns that spawn them,
// how fast they move at a given survival time, per-lane danger, and whether a
// player at an angle is inside one. Shared by the room host; the single-player
// loop in App.tsx keeps its own copy of the same numbers for now.

export const TAU = Math.PI * 2;
export const SIDES = 6;
export const SECTOR = TAU / SIDES;
export const HEX_R = 55;
export const PLAYER_R = HEX_R + 16;
export const PLAYER_SPEED = 6.8; // radians per second
export const HALF_W = 6; // player collision half-thickness in px
export const DANGER_RANGE = 250; // px over which lane danger ramps from 0 to 1
export const SPAWN_MARGIN = 60; // px beyond the screen's half-diagonal where patterns appear

export type WallKind = 'ring' | 'chunk' | 'spiral';

export interface Wall {
  sec: number;
  dist: number;
  thick: number;
}

export interface Spawned {
  kind: WallKind;
  walls: Wall[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Inward wall speed in px/s at survival time t: 170 rising to 410 by t = 34s. */
export function wallSpeed(t: number): number {
  return 170 + Math.min(240, t * 7);
}

/** Distance kept between patterns at survival time t: 330 px narrowing to 200 by t = 32.5s. */
export function spawnSpacing(t: number): number {
  return 330 - Math.min(130, t * 4);
}

/** Where patterns appear for a w × h field. */
export function spawnRadius(w: number, h: number): number {
  return Math.hypot(w, h) / 2 + SPAWN_MARGIN;
}

/** Seconds for a wall to travel `dist` px starting at survival time t0 under wallSpeed. */
export function travelTime(dist: number, t0: number): number {
  const T_SAT = 240 / 7;
  if (t0 >= T_SAT) return dist / 410;
  const k = 170 * t0 + 3.5 * t0 * t0 + dist;
  const t = (-170 + Math.sqrt(170 * 170 + 14 * k)) / 7;
  if (t <= T_SAT) return t - t0;
  const covered = 170 * (T_SAT - t0) + 3.5 * (T_SAT * T_SAT - t0 * t0);
  return T_SAT - t0 + (dist - covered) / 410;
}

export function sectorOf(angle: number): number {
  return Math.floor((((angle % TAU) + TAU) % TAU) / SECTOR) % SIDES;
}

/** A ring with one or two gaps; two are guaranteed for the first `twoGapSeconds`. */
export function spawnRing(R: number, t: number, rnd: () => number, twoGapSeconds = 8): Spawned {
  const gaps = t < twoGapSeconds || rnd() < 0.55 ? 2 : 1;
  const open: boolean[] = new Array(SIDES).fill(false);
  let n = 0;
  while (n < gaps) {
    const g = Math.floor(rnd() * SIDES) % SIDES;
    if (!open[g]) {
      open[g] = true;
      n++;
    }
  }
  const thick = 32 + rnd() * 18;
  const walls: Wall[] = [];
  for (let i = 0; i < SIDES; i++) if (!open[i]) walls.push({ sec: i, dist: R, thick });
  return { kind: 'ring', walls };
}

/** Three or four adjacent thick walls. */
export function spawnChunk(R: number, rnd: () => number): Spawned {
  const len = rnd() < 0.5 ? 3 : 4;
  const st0 = Math.floor(rnd() * SIDES) % SIDES;
  const walls: Wall[] = [];
  for (let i = 0; i < len; i++) walls.push({ sec: (st0 + i) % SIDES, dist: R, thick: 55 });
  return { kind: 'chunk', walls };
}

/** Five thin walls stepping round the hexagon at increasing distance. */
export function spawnSpiral(R: number, rnd: () => number): Spawned {
  const dir = rnd() < 0.5 ? 1 : -1;
  const st0 = Math.floor(rnd() * SIDES) % SIDES;
  const step = 95 + rnd() * 40;
  const walls: Wall[] = [];
  for (let i = 0; i < 5; i++) {
    const sec = (((st0 + dir * i) % SIDES) + SIDES) % SIDES;
    walls.push({ sec, dist: R + i * step, thick: 30 });
  }
  return { kind: 'spiral', walls };
}

/** The pattern mix: 45% rings, 30% chunks, 25% spirals. */
export function spawnPattern(R: number, t: number, rnd: () => number, twoGapSeconds = 8): Spawned {
  const r = rnd();
  if (r < 0.45) return spawnRing(R, t, rnd, twoGapSeconds);
  if (r < 0.75) return spawnChunk(R, rnd);
  return spawnSpiral(R, rnd);
}

/** Moves walls inward by dt at survival time t and drops the ones past the centre. Returns the kept array. */
export function advanceWalls(walls: Wall[], dt: number, t: number): Wall[] {
  const speed = wallSpeed(t);
  const kept: Wall[] = [];
  for (const wl of walls) {
    wl.dist -= speed * dt;
    if (wl.dist + wl.thick > HEX_R - 6) kept.push(wl);
  }
  return kept;
}

/** True when the outermost wall has left room for the next pattern. */
export function roomToSpawn(walls: Wall[], R: number, t: number): boolean {
  let maxD = 0;
  for (const wl of walls) {
    const d = wl.dist + wl.thick;
    if (d > maxD) maxD = d;
  }
  return maxD < R - spawnSpacing(t);
}

/** Danger per lane (0..1 from the nearest wall still ahead of the player) into `out`; returns the overall pressure. */
export function laneDanger(walls: Wall[], out: number[]): number {
  let anyD = Infinity;
  const laneMin: number[] = new Array(SIDES).fill(Infinity);
  for (const wl of walls) {
    const d = wl.dist - PLAYER_R;
    if (d + wl.thick < -HALF_W) continue;
    if (d < laneMin[wl.sec]) laneMin[wl.sec] = d;
    if (d < anyD) anyD = d;
  }
  for (let i = 0; i < SIDES; i++) out[i] = laneMin[i] === Infinity ? 0 : clamp01(1 - laneMin[i] / DANGER_RANGE);
  return anyD === Infinity ? 0 : clamp01(1 - anyD / DANGER_RANGE);
}

/** Whether a player in `sec` is inside a wall right now. */
export function hits(walls: Wall[], sec: number): boolean {
  for (const wl of walls) {
    if (wl.sec === sec && wl.dist < PLAYER_R + HALF_W && wl.dist + wl.thick > PLAYER_R - HALF_W) return true;
  }
  return false;
}
