// The board Worker: runs come in from phones, the projector reads them back.
// POST /run stores one run summary and answers with its rank in the window;
// GET /board returns the top runs, the latest runs, and the room's numbers.

import {
  MAX_BODY_BYTES,
  STATS_ROWS,
  allowOrigin,
  computeStats,
  parseBoardQuery,
  parseRun,
  type RunRow,
  type StatsRow,
} from './lib';

export interface Env {
  DB: D1Database;
  /** The site origin allowed to call this Worker, e.g. https://edobry.github.io. */
  SITE_ORIGIN: string;
}

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

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

async function postRun(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413, headers);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413, headers);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'body must be JSON' }, 400, headers);
  }
  const parsed = parseRun(body);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request, env);
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      if (request.method === 'POST' && url.pathname === '/run') return await postRun(request, env, headers);
      if (request.method === 'GET' && url.pathname === '/board') return await getBoard(request, env, headers);
      if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, routes: ['POST /run', 'GET /board'] }, 200, headers);
    } catch (err) {
      console.error(err);
      return json({ error: 'internal' }, 500, headers);
    }
    return json({ error: 'not found' }, 404, headers);
  },
} satisfies ExportedHandler<Env>;
