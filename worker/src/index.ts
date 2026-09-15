// The board Worker: runs come in from phones, the projector reads them back.
// POST /run stores one run summary and answers with its rank in the window;
// GET /board returns the top runs, the latest runs, and the room's numbers;
// GET /stats groups the window's runs by variant for the analytics view;
// POST /prefs stores guided-listen verdicts, GET /prefs/summary counts them.

import {
  MAX_BODY_BYTES,
  STATS_CACHE_MS,
  STATS_MAX_ROWS,
  STATS_ROWS,
  allowOrigin,
  computeStats,
  computeVariantStats,
  parseBoardQuery,
  parsePref,
  parseRun,
  parseStatsQuery,
  statsQueryKey,
  summarizePrefs,
  type PrefSummaryRow,
  type RunRow,
  type StatsRow,
  type VariantRow,
} from './lib';

import { Room } from './room';

export { Room };

export interface Env {
  DB: D1Database;
  ROOM: DurableObjectNamespace<Room>;
  /** The site origin allowed to call this Worker, e.g. https://edobry.github.io. */
  SITE_ORIGIN: string;
}

const ROOM_CODE = /^[a-z0-9-]{1,32}$/;

const HOUR_MS = 3600 * 1000;

function cors(request: Request, env: Env): Record<string, string> {
  const origin = allowOrigin(request.headers.get('Origin'), env.SITE_ORIGIN);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, headers: Record<string, string>, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl, ...headers },
  });
}

/**
 * Aggregate answers reused for STATS_CACHE_MS, keyed by route and parsed
 * query. In isolate memory: the Cache API is a no-op on workers.dev, and the
 * point is only that a polling projector reads D1 twice a minute, not every poll.
 */
const summaryCache = new Map<string, { at: number; data: unknown }>();
const SUMMARY_CACHE_CONTROL = `public, max-age=${STATS_CACHE_MS / 1000}`;

async function cached(key: string, compute: () => Promise<unknown>): Promise<unknown> {
  const now = Date.now();
  const hit = summaryCache.get(key);
  if (hit && now - hit.at < STATS_CACHE_MS) return hit.data;
  const data = await compute();
  summaryCache.set(key, { at: now, data });
  // Drop stale entries so odd one-off queries do not accumulate.
  for (const [k, v] of summaryCache) if (now - v.at >= STATS_CACHE_MS) summaryCache.delete(k);
  return data;
}

/** The request body as JSON under the byte limit, or the response that refuses it. */
async function readJson(request: Request, headers: Record<string, string>): Promise<{ body: unknown } | { refused: Response }> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BODY_BYTES) return { refused: json({ error: 'body too large' }, 413, headers) };
  const text = await request.text();
  // Bytes, not UTF-16 code units: a body of multi-byte characters must not slip under the limit.
  if (text.length > MAX_BODY_BYTES || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { refused: json({ error: 'body too large' }, 413, headers) };
  }
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { refused: json({ error: 'body must be JSON' }, 400, headers) };
  }
}

async function postRun(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const read = await readJson(request, headers);
  if ('refused' in read) return read.refused;
  const parsed = parseRun(read.body);
  if ('error' in parsed) return json({ error: parsed.error }, 400, headers);
  const row: RunRow = parsed.row;
  const at = Date.now();
  const since = at - parseBoardQuery(new URL(request.url).searchParams).hours * HOUR_MS;

  const [, ranked, total] = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO runs (at, device, tag, variant, slot, build, time, death,
           reaction_median, reaction_p90, reaction_n, anticipation, anticipation_n,
           beat_r, beat_phase, beat_n, overshoots, reversals, countin_onsets, countin_r, tuning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        at,
        row.device,
        row.tag,
        row.variant,
        row.slot,
        row.build,
        row.time,
        row.death,
        row.reaction_median,
        row.reaction_p90,
        row.reaction_n,
        row.anticipation,
        row.anticipation_n,
        row.beat_r,
        row.beat_phase,
        row.beat_n,
        row.overshoots,
        row.reversals,
        row.countin_onsets,
        row.countin_r,
        row.tuning,
      ),
    env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE at >= ? AND time > ?').bind(since, row.time),
    env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE at >= ?').bind(since),
  ]);
  const above = Number((ranked.results[0] as { n: number }).n);
  const count = Number((total.results[0] as { n: number }).n);
  return json({ rank: above + 1, total: count, tag: row.tag }, 201, headers);
}

async function getBoard(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const { limit, hours } = parseBoardQuery(new URL(request.url).searchParams);
  const since = Date.now() - hours * HOUR_MS;
  const [top, feed, stats] = await env.DB.batch([
    env.DB.prepare('SELECT tag, time, death, at FROM runs WHERE at >= ? ORDER BY time DESC, at ASC LIMIT ?').bind(since, limit),
    env.DB.prepare('SELECT tag, time, death, at FROM runs WHERE at >= ? ORDER BY at DESC LIMIT ?').bind(since, limit),
    env.DB
      .prepare('SELECT device, time, death, reaction_median, beat_r FROM runs WHERE at >= ? ORDER BY at DESC LIMIT ?')
      .bind(since, STATS_ROWS),
  ]);
  return json(
    { since, hours, top: top.results, feed: feed.results, stats: computeStats(stats.results as unknown as StatsRow[]) },
    200,
    headers,
  );
}

/**
 * Where a stats window starts: the later of the hours cutoff and the since
 * marker. A build marker is the build's first run; an unknown build yields
 * null, an empty window.
 */
async function windowStart(query: ReturnType<typeof parseStatsQuery>, env: Env, now: number): Promise<number | null> {
  let since = query.hours === null ? 0 : now - query.hours * HOUR_MS;
  let markerAt: number | null = null;
  if (query.since?.kind === 'timestamp') markerAt = query.since.at;
  else if (query.since?.kind === 'build') {
    const first = await env.DB.prepare('SELECT MIN(at) AS at FROM runs WHERE build = ?').bind(query.since.build).first<{ at: number | null }>();
    markerAt = first?.at ?? null;
    if (markerAt === null) return null;
  }
  if (markerAt !== null) since = Math.max(since, markerAt);
  return since;
}

async function getStats(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const query = parseStatsQuery(new URL(request.url).searchParams);
  const data = await cached('stats|' + statsQueryKey(query), async () => {
    const since = await windowStart(query, env, Date.now());
    const columns = 'variant, slot, device, time, death, reaction_median, reaction_p90, anticipation, beat_r, countin_onsets, countin_r';
    let rows: VariantRow[] = [];
    if (since !== null) {
      const read = query.variant === null
        ? env.DB.prepare(`SELECT ${columns} FROM runs WHERE at >= ? ORDER BY at DESC LIMIT ?`).bind(since, STATS_MAX_ROWS)
        : env.DB.prepare(`SELECT ${columns} FROM runs WHERE at >= ? AND variant = ? ORDER BY at DESC LIMIT ?`).bind(since, query.variant, STATS_MAX_ROWS);
      rows = (await read.all()).results as unknown as VariantRow[];
    }
    return {
      since,
      hours: query.hours,
      variant: query.variant,
      marker: query.since,
      rows: rows.length,
      truncated: rows.length >= STATS_MAX_ROWS,
      groups: computeVariantStats(rows),
    };
  });
  return json(data, 200, headers, SUMMARY_CACHE_CONTROL);
}

async function postPrefs(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const read = await readJson(request, headers);
  if ('refused' in read) return read.refused;
  const parsed = parsePref(read.body);
  if ('error' in parsed) return json({ error: parsed.error }, 400, headers);
  const row = parsed.row;
  await env.DB.prepare('INSERT INTO prefs (at, device, build, step, verdict, base, final) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), row.device, row.build, row.step, row.verdict, row.base, row.final)
    .run();
  return json({ ok: true }, 201, headers);
}

async function getPrefsSummary(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const query = parseStatsQuery(new URL(request.url).searchParams);
  const data = await cached('prefs|' + statsQueryKey({ ...query, variant: null }), async () => {
    const since = await windowStart(query, env, Date.now());
    let rows: PrefSummaryRow[] = [];
    if (since !== null) {
      const read = env.DB.prepare('SELECT step, verdict, final FROM prefs WHERE at >= ? ORDER BY at DESC LIMIT ?').bind(since, STATS_MAX_ROWS);
      rows = (await read.all()).results as unknown as PrefSummaryRow[];
    }
    return { since, hours: query.hours, marker: query.since, rows: rows.length, truncated: rows.length >= STATS_MAX_ROWS, ...summarizePrefs(rows) };
  });
  return json(data, 200, headers, SUMMARY_CACHE_CONTROL);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request, env);
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    // /room/<code>/ws: pads and the host meet in the room's Durable Object.
    const room = url.pathname.match(/^\/room\/([^/]+)\/ws$/);
    if (room) {
      const code = decodeURIComponent(room[1]).toLowerCase();
      if (!ROOM_CODE.test(code)) return json({ error: 'bad room code' }, 400, headers);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426, headers);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }
    try {
      if (request.method === 'POST' && url.pathname === '/run') return await postRun(request, env, headers);
      if (request.method === 'GET' && url.pathname === '/board') return await getBoard(request, env, headers);
      if (request.method === 'GET' && url.pathname === '/stats') return await getStats(request, env, headers);
      if (request.method === 'POST' && url.pathname === '/prefs') return await postPrefs(request, env, headers);
      if (request.method === 'GET' && url.pathname === '/prefs/summary') return await getPrefsSummary(request, env, headers);
      if (request.method === 'GET' && url.pathname === '/') {
        return json({ ok: true, routes: ['POST /run', 'GET /board', 'GET /stats', 'POST /prefs', 'GET /prefs/summary', 'WS /room/<code>/ws?role=pad|host'] }, 200, headers);
      }
    } catch (err) {
      console.error(err);
      return json({ error: 'internal' }, 500, headers);
    }
    return json({ error: 'not found' }, 404, headers);
  },
} satisfies ExportedHandler<Env>;
