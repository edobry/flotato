// The pure half of the board Worker: what a run submission must look like,
// how tags are normalized, and how the board's numbers are computed from rows.
// No I/O here, so it is unit-tested directly; the handler in index.ts is thin.

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_STRING = 64;
export const TAG_LENGTH = 3;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
export const DEFAULT_WINDOW_HOURS = 12;
export const MAX_WINDOW_HOURS = 24 * 30;
/** Rows read to compute medians; the window rarely holds more in one evening. */
export const STATS_ROWS = 500;

export const DEATH_CLASSES = ['jitter', 'overshoot', 'wrong way', 'freeze', 'late'] as const;
export type DeathClass = (typeof DEATH_CLASSES)[number];

/** Tags a room full of people should not see on a projector. Uppercase, exact. */
const TAG_BLOCKLIST = new Set(['ASS', 'FAG', 'FUK', 'FUC', 'KKK', 'CUM', 'DIE', 'NIG', 'SEX', 'TIT', 'COK', 'JEW', 'GAY']);

/** The row the game posts, mirroring src/player/observer.ts RunSummary plus identity. */
export interface RunRow {
  device: string;
  tag: string;
  variant: string;
  slot: string;
  build: string;
  time: number;
  death: DeathClass;
  reaction_median: number | null;
  reaction_p90: number | null;
  reaction_n: number;
  anticipation: number | null;
  anticipation_n: number;
  beat_r: number | null;
  beat_phase: number | null;
  beat_n: number;
  overshoots: number;
  reversals: number;
  countin_onsets: number | null;
  countin_r: number | null;
  tuning: string;
}

type Json = Record<string, unknown>;

const isObject = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const count = (x: unknown): number => (finite(x) && x >= 0 ? Math.floor(x) : 0);
/** A metric is null when its sample count is zero, so the board never averages placeholders. */
const metric = (x: unknown, n: number): number | null => (n > 0 && finite(x) ? x : null);
const str = (x: unknown, fallback = ''): string => (typeof x === 'string' ? x.slice(0, MAX_STRING) : fallback);

/** Uppercase alphanumerics, at most three; empty or blocked tags get a neutral replacement. */
export function normalizeTag(raw: unknown): string {
  const tag = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, TAG_LENGTH);
  if (!tag || TAG_BLOCKLIST.has(tag)) return '???';
  return tag;
}

/** Parses a submission; returns the row or a reason it was refused. */
export function parseRun(body: unknown): { row: RunRow } | { error: string } {
  if (!isObject(body)) return { error: 'body must be an object' };
  const run = body.run;
  if (!isObject(run)) return { error: 'run is required' };
  if (!finite(run.time) || run.time < 0 || run.time > 3600) return { error: 'run.time must be a number of seconds' };
  const death = typeof run.death === 'string' && (DEATH_CLASSES as readonly string[]).includes(run.death) ? (run.death as DeathClass) : null;
  if (!death) return { error: 'run.death must be a death class' };
  const device = str(body.device);
  if (!device) return { error: 'device is required' };

  const reaction = isObject(run.reaction) ? run.reaction : {};
  const anticipation = isObject(run.anticipation) ? run.anticipation : {};
  const beat = isObject(run.beat) ? run.beat : {};
  const loop = isObject(run.loop) ? run.loop : {};
  const countIn = isObject(run.countIn) ? run.countIn : null;
  const reactionN = count(reaction.n);
  const anticipationN = count(anticipation.n);
  const beatN = count(beat.n);
  const countInOnsets = countIn ? count(countIn.onsets) : null;

  let tuning = '{}';
  if (isObject(body.tuning)) {
    tuning = JSON.stringify(body.tuning);
    if (tuning.length > 4096) tuning = '{}';
  }

  return {
    row: {
      device,
      tag: normalizeTag(body.tag),
      variant: str(body.variant, 'default') || 'default',
      slot: str(body.slot),
      build: str(body.build),
      time: run.time,
      death,
      reaction_median: metric(reaction.median, reactionN),
      reaction_p90: metric(reaction.p90, reactionN),
      reaction_n: reactionN,
      anticipation: metric(anticipation.ratio, anticipationN),
      anticipation_n: anticipationN,
      beat_r: metric(beat.r, beatN),
      beat_phase: metric(beat.phase, beatN),
      beat_n: beatN,
      overshoots: count(loop.overshoots),
      reversals: count(loop.reversals),
      countin_onsets: countInOnsets,
      countin_r: countIn && countInOnsets !== null ? metric(countIn.r, countInOnsets) : null,
      tuning,
    },
  };
}

export interface BoardQuery {
  limit: number;
  hours: number;
}

/** Clamps the board's query parameters to sane ranges. */
export function parseBoardQuery(params: URLSearchParams): BoardQuery {
  const positive = (raw: string | null, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(positive(params.get('limit'), DEFAULT_LIMIT))));
  const hours = Math.min(MAX_WINDOW_HOURS, positive(params.get('hours'), DEFAULT_WINDOW_HOURS));
  return { limit, hours };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface StatsRow {
  device: string;
  time: number;
  death: string;
  reaction_median: number | null;
  beat_r: number | null;
}

export interface BoardStats {
  runs: number;
  devices: number;
  best: number | null;
  reactionMedian: number | null;
  beatR: number | null;
  deaths: Record<string, number>;
}

/** The room's numbers from the rows in the window (most recent first or any order). */
export function computeStats(rows: StatsRow[]): BoardStats {
  const deaths: Record<string, number> = {};
  for (const d of DEATH_CLASSES) deaths[d] = 0;
  const devices = new Set<string>();
  let best: number | null = null;
  const reactions: number[] = [];
  const beats: number[] = [];
  for (const r of rows) {
    devices.add(r.device);
    if (best === null || r.time > best) best = r.time;
    deaths[r.death] = (deaths[r.death] ?? 0) + 1;
    if (r.reaction_median !== null) reactions.push(r.reaction_median);
    if (r.beat_r !== null) beats.push(r.beat_r);
  }
  return { runs: rows.length, devices: devices.size, best, reactionMedian: median(reactions), beatR: median(beats), deaths };
}

/** The browser origins allowed to read and write: the Pages site, and local dev servers. */
export function allowOrigin(origin: string | null, production: string): string | null {
  if (!origin) return null;
  if (origin === production) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)) return origin;
  return null;
}
