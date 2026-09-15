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
/** Rows read for the per-variant stats; a whole demo evening fits, a month may not. */
export const STATS_MAX_ROWS = 5000;
/** How long a /stats answer is reused before D1 is read again. */
export const STATS_CACHE_MS = 30 * 1000;

export const DEATH_CLASSES = ['jitter', 'overshoot', 'wrong way', 'freeze', 'late'] as const;
export type DeathClass = (typeof DEATH_CLASSES)[number];

/** The guided listen's answers, mirroring src/tuning/guide.ts Verdict. */
export const VERDICTS = ['A', 'B', 'same', 'skip'] as const;
export type Verdict = (typeof VERDICTS)[number];
/** A tuning diff serialized into a row; longer ones are stored empty rather than refused. */
export const MAX_DIFF_JSON = 4096;
/** How many finals the prefs summary ranks. */
export const TOP_FINALS = 5;

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

const isPrimitive = (x: unknown): x is string | number | boolean => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean';

/**
 * A tuning diff as bounded JSON: only string, number and boolean values (a
 * Tuning holds nothing else), so a summary never prints a nested object;
 * over the bound it is stored as empty, so the row is kept and the diff is not.
 */
const diffJson = (x: Json): string => {
  const flat: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(x)) if (isPrimitive(v)) flat[k] = v;
  const json = JSON.stringify(flat);
  return json.length > MAX_DIFF_JSON ? '{}' : json;
};

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

  const tuning = isObject(body.tuning) ? diffJson(body.tuning) : '{}';

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

/** The p-quantile (0..1) with linear interpolation between order statistics; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
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

export interface StatsQuery {
  /** The window in hours, or null when a since marker alone sets the start. */
  hours: number | null;
  /** Exact-match filter on the variant column, or null for every variant. */
  variant: string | null;
  /** A session marker: a ms timestamp, or a build id whose first run starts the window. */
  since: { kind: 'timestamp'; at: number } | { kind: 'build'; build: string } | null;
}

/** A cache key that depends on the query's values, not on the object's field order. */
export function statsQueryKey(q: StatsQuery): string {
  const since = q.since === null ? '' : q.since.kind === 'timestamp' ? 't' + q.since.at : 'b' + q.since.build;
  return [q.hours ?? '', q.variant ?? '', since].join('|');
}

/**
 * Parses /stats parameters. `hours` clamps like the board's; `since` is a ms
 * timestamp (all digits) or a build id. A marker replaces the default window;
 * with both given, the later start wins.
 */
export function parseStatsQuery(params: URLSearchParams): StatsQuery {
  const variantRaw = params.get('variant');
  const variant = variantRaw ? variantRaw.slice(0, MAX_STRING) : null;
  const sinceRaw = (params.get('since') ?? '').trim();
  let since: StatsQuery['since'] = null;
  if (/^\d{10,}$/.test(sinceRaw)) since = { kind: 'timestamp', at: Number(sinceRaw) };
  else if (sinceRaw) since = { kind: 'build', build: sinceRaw.slice(0, MAX_STRING) };
  const hours = since && !params.has('hours') ? null : parseBoardQuery(params).hours;
  return { hours, variant, since };
}

/** The columns /stats reads per run; `death` is a class because parseRun admits nothing else into the table. */
export interface VariantRow {
  variant: string;
  slot: string;
  device: string;
  time: number;
  death: DeathClass;
  reaction_median: number | null;
  reaction_p90: number | null;
  anticipation: number | null;
  beat_r: number | null;
  countin_onsets: number | null;
  countin_r: number | null;
}

export interface VariantStats {
  variant: string;
  slot: string;
  runs: number;
  devices: number;
  time: { median: number | null; p90: number | null; best: number | null };
  /** Medians of the per-run reaction median and p90. */
  reaction: { median: number | null; p90: number | null };
  beatR: number | null;
  anticipation: number | null;
  countIn: { onsets: number | null; r: number | null };
  deaths: Record<string, number>;
}

/** One group per (variant, slot), sorted by runs then variant, each with its medians and death histogram. */
export function computeVariantStats(rows: VariantRow[]): VariantStats[] {
  interface Acc {
    variant: string;
    slot: string;
    devices: Set<string>;
    times: number[];
    reactionMedians: number[];
    reactionP90s: number[];
    anticipations: number[];
    beats: number[];
    countInOnsets: number[];
    countInRs: number[];
    deaths: Record<string, number>;
  }
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const key = r.variant + '\u0000' + r.slot;
    let g = groups.get(key);
    if (!g) {
      g = { variant: r.variant, slot: r.slot, devices: new Set(), times: [], reactionMedians: [], reactionP90s: [], anticipations: [], beats: [], countInOnsets: [], countInRs: [], deaths: {} };
      for (const d of DEATH_CLASSES) g.deaths[d] = 0;
      groups.set(key, g);
    }
    g.devices.add(r.device);
    g.times.push(r.time);
    g.deaths[r.death] = (g.deaths[r.death] ?? 0) + 1;
    if (r.reaction_median !== null) g.reactionMedians.push(r.reaction_median);
    if (r.reaction_p90 !== null) g.reactionP90s.push(r.reaction_p90);
    if (r.anticipation !== null) g.anticipations.push(r.anticipation);
    if (r.beat_r !== null) g.beats.push(r.beat_r);
    if (r.countin_onsets !== null) g.countInOnsets.push(r.countin_onsets);
    if (r.countin_r !== null) g.countInRs.push(r.countin_r);
  }
  const out: VariantStats[] = [];
  for (const g of groups.values()) {
    out.push({
      variant: g.variant,
      slot: g.slot,
      runs: g.times.length,
      devices: g.devices.size,
      time: { median: median(g.times), p90: percentile(g.times, 0.9), best: g.times.length ? Math.max(...g.times) : null },
      reaction: { median: median(g.reactionMedians), p90: median(g.reactionP90s) },
      beatR: median(g.beats),
      anticipation: median(g.anticipations),
      countIn: { onsets: median(g.countInOnsets), r: median(g.countInRs) },
      deaths: g.deaths,
    });
  }
  out.sort((a, b) => b.runs - a.runs || a.variant.localeCompare(b.variant) || a.slot.localeCompare(b.slot));
  return out;
}

/** A guided-listen row: a verdict on one step, or a finished walk's discovered diff. */
export interface PrefRow {
  device: string;
  build: string;
  step: string | null;
  verdict: Verdict | null;
  base: string | null;
  final: string | null;
}

/** Parses a POST /prefs body: `{ device, step, verdict, base }` per verdict or `{ device, final }` per finished walk. */
export function parsePref(body: unknown): { row: PrefRow } | { error: string } {
  if (!isObject(body)) return { error: 'body must be an object' };
  const device = str(body.device);
  if (!device) return { error: 'device is required' };
  const build = str(body.build);
  if (isObject(body.final)) {
    if (body.step !== undefined || body.verdict !== undefined) return { error: 'final and step are exclusive' };
    return { row: { device, build, step: null, verdict: null, base: null, final: diffJson(body.final) } };
  }
  const step = str(body.step);
  if (!step) return { error: 'step or final is required' };
  const verdict = typeof body.verdict === 'string' && (VERDICTS as readonly string[]).includes(body.verdict) ? (body.verdict as Verdict) : null;
  if (!verdict) return { error: 'verdict must be A, B, same or skip' };
  if (!isObject(body.base)) return { error: 'base must be an object' };
  return { row: { device, build, step, verdict, base: diffJson(body.base), final: null } };
}

/** The columns the prefs summary reads per row. */
export interface PrefSummaryRow {
  step: string | null;
  verdict: string | null;
  final: string | null;
}

export interface StepSummary {
  id: string;
  A: number;
  B: number;
  same: number;
  skip: number;
  n: number;
}

export interface PrefsSummary {
  verdicts: number;
  walks: number;
  steps: StepSummary[];
  /** The most common discovered diffs, encoded as `?tune=` strings, with counts. */
  finals: { diff: string; n: number }[];
}

/** A stored diff as the `key=value,…` string the game reads, keys sorted so equal diffs compare equal; `default` when empty. */
export function encodeStoredDiff(json: string | null): string {
  let parsed: unknown = null;
  try {
    parsed = json === null ? null : JSON.parse(json);
  } catch {
    parsed = null;
  }
  if (!isObject(parsed)) return 'default';
  const keys = Object.keys(parsed).sort();
  return keys.length ? keys.map((k) => k + '=' + String(parsed[k])).join(',') : 'default';
}

/** Per step, how the verdicts split; plus how many walks finished and on which diffs. */
export function summarizePrefs(rows: PrefSummaryRow[]): PrefsSummary {
  const steps = new Map<string, StepSummary>();
  const finals = new Map<string, number>();
  let verdicts = 0;
  let walks = 0;
  for (const r of rows) {
    if (r.step !== null && r.verdict !== null && (VERDICTS as readonly string[]).includes(r.verdict)) {
      verdicts++;
      let s = steps.get(r.step);
      if (!s) {
        s = { id: r.step, A: 0, B: 0, same: 0, skip: 0, n: 0 };
        steps.set(r.step, s);
      }
      s[r.verdict as Verdict]++;
      s.n++;
    } else if (r.final !== null) {
      walks++;
      const diff = encodeStoredDiff(r.final);
      finals.set(diff, (finals.get(diff) ?? 0) + 1);
    }
  }
  return {
    verdicts,
    walks,
    steps: [...steps.values()].sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)),
    finals: [...finals.entries()]
      .map(([diff, n]) => ({ diff, n }))
      .sort((a, b) => b.n - a.n || a.diff.localeCompare(b.diff))
      .slice(0, TOP_FINALS),
  };
}

/** The browser origins allowed to read and write: the Pages site, and local dev servers. */
export function allowOrigin(origin: string | null, production: string): string | null {
  if (!origin) return null;
  if (origin === production) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)) return origin;
  return null;
}
