// The board's analytics view (/board/?view=stats): the window's runs grouped
// by tuning variant, one row each with medians and a death-class bar, so a
// register A/B or a session argues from numbers. Polls slowly; the Worker
// caches the answer for as long.

import { useEffect, useState, type CSSProperties } from 'react';
import { BOARD_URL } from '../config';

const POLL_MS = 30000;
const DASH = '—';
const PASS_THROUGH = ['hours', 'since', 'variant'] as const;
/** The classes of worker/src/lib.ts DEATH_CLASSES in the board's order (the common ones first), as the room view lists them. */
const DEATH_ORDER = ['late', 'freeze', 'overshoot', 'jitter', 'wrong way'] as const;
const DEATH_COLOR: Record<string, string> = {
  late: 'hsl(195, 85%, 62%)',
  freeze: 'hsl(265, 70%, 68%)',
  overshoot: 'hsl(30, 90%, 60%)',
  jitter: 'hsl(55, 90%, 60%)',
  'wrong way': 'hsl(350, 80%, 62%)',
};

interface Group {
  variant: string;
  slot: string;
  runs: number;
  devices: number;
  time: { median: number | null; p90: number | null; best: number | null };
  reaction: { median: number | null; p90: number | null };
  beatR: number | null;
  anticipation: number | null;
  countIn: { onsets: number | null; r: number | null };
  deaths: Record<string, number>;
}

interface StatsData {
  since: number | null;
  hours: number | null;
  variant: string | null;
  marker: { kind: 'timestamp'; at: number } | { kind: 'build'; build: string } | null;
  rows: number;
  truncated: boolean;
  groups: Group[];
}

interface PrefsData {
  verdicts: number;
  walks: number;
  steps: { id: string; A: number; B: number; same: number; skip: number; n: number }[];
  finals: { diff: string; n: number }[];
}

/** The query the page was opened with, forwarded to the endpoints as given. */
function statsQuery(): string {
  try {
    const p = new URLSearchParams(location.search);
    const out = new URLSearchParams();
    for (const k of PASS_THROUGH) {
      const v = p.get(k);
      if (v) out.set(k, v);
    }
    const s = out.toString();
    return s ? '?' + s : '';
  } catch {
    return '';
  }
}

async function fetchJson<T>(route: string, query: string): Promise<T> {
  const res = await fetch(`${BOARD_URL}${route}${query}`);
  if (!res.ok) throw new Error('board answered ' + res.status);
  return (await res.json()) as T;
}

const page: CSSProperties = {
  minHeight: '100vh',
  background: '#000',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  display: 'flex',
  flexDirection: 'column',
  gap: '2vh',
  padding: '3vh 3vw',
  boxSizing: 'border-box',
};
const title: CSSProperties = { fontSize: '4vh', fontWeight: 800, letterSpacing: '0.35em', textAlign: 'center' };
const subline: CSSProperties = { fontSize: '2vh', letterSpacing: '0.15em', opacity: 0.6, textAlign: 'center' };
/** Column widths in em of the row font, so the header (smaller type inside) lines up with the cells; sums under a 16:9 width. */
const columns = 'minmax(10em, 1.5fr) 2.2em 4em 4.5em 7em 7.5em 4.2em 4.2em 5em minmax(8em, 1fr)';
const HEADERS = ['VARIANT', 'AB', 'RUNS', 'PLAYERS', 'TIME MED · P90', 'REACT MED · P90', 'BEAT R', 'ANTIC', 'COUNT-IN R', 'DEATHS'];
const row: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: columns,
  gap: '1em',
  fontSize: '2.3vh',
  lineHeight: 1.4,
  alignItems: 'center',
  padding: '1.2vh 0',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};
const headRow: CSSProperties = { ...row, alignItems: 'end', padding: '0 0 1vh', borderBottom: '1px solid rgba(255,255,255,0.15)' };
const headCell: CSSProperties = { fontSize: '1.7vh', letterSpacing: '0.15em', opacity: 0.5 };
const footer: CSSProperties = { marginTop: 'auto', fontSize: '1.8vh', opacity: 0.45, textAlign: 'center', letterSpacing: '0.1em' };
const prefsHeading: CSSProperties = { fontSize: '2vh', letterSpacing: '0.25em', opacity: 0.55, marginBottom: '1vh' };
const prefsLine: CSSProperties = { fontSize: '2.1vh', lineHeight: 1.6, display: 'grid', gridTemplateColumns: '9em auto', gap: '1em' };

const num = (v: number | null, digits = 2) => (v === null ? DASH : v.toFixed(digits));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'S'}`;
const pair = (a: number | null, b: number | null, digits: number) => (
  <span>
    {num(a, digits)} <span style={{ opacity: 0.5 }}>· {num(b, digits)}</span>
  </span>
);

function windowLabel(d: StatsData): string {
  const parts: string[] = [];
  if (d.marker?.kind === 'build') parts.push(d.since === null ? `BUILD ${d.marker.build} · NO RUNS` : `SINCE BUILD ${d.marker.build}`);
  else if (d.marker?.kind === 'timestamp') parts.push('SINCE ' + new Date(d.marker.at).toLocaleString());
  if (d.hours !== null) parts.push(`LAST ${d.hours}H`);
  if (d.variant !== null) parts.push(`VARIANT ${d.variant}`);
  return parts.join(' · ');
}

function DeathBar({ deaths, runs }: { deaths: Record<string, number>; runs: number }) {
  return (
    <div
      style={{ display: 'flex', height: '2.2vh', width: '100%', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}
      title={DEATH_ORDER.map((d) => `${d} ${deaths[d] ?? 0}`).join(' · ')}
    >
      {DEATH_ORDER.map((d) => {
        const n = deaths[d] ?? 0;
        return n > 0 && runs > 0 ? <div key={d} style={{ width: `${(100 * n) / runs}%`, background: DEATH_COLOR[d] }} /> : null;
      })}
    </div>
  );
}

/** The guided listen's verdicts in the window: per step, how the room split; the walks' most common picks. */
function Prefs({ prefs }: { prefs: PrefsData }) {
  return (
    <div>
      <div style={prefsHeading}>
        GUIDED LISTEN · {plural(prefs.verdicts, 'VERDICT')} · {plural(prefs.walks, 'WALK')}
      </div>
      {prefs.steps.length === 0 && <div style={{ ...prefsLine, display: 'block', opacity: 0.5 }}>no verdicts in the window</div>}
      {prefs.steps.map((s) => (
        <div key={s.id} style={prefsLine}>
          <span style={{ opacity: 0.7 }}>{s.id}</span>
          <span>
            A <b>{s.A}</b> · B <b>{s.B}</b> · same <b>{s.same}</b> · skip <b>{s.skip}</b>
          </span>
        </div>
      ))}
      {prefs.finals.map((f) => (
        <div key={f.diff} style={{ ...prefsLine, opacity: 0.8 }}>
          <span style={{ opacity: 0.7 }}>{f === prefs.finals[0] ? 'picks' : ''}</span>
          <span style={{ overflowWrap: 'anywhere' }}>
            <b>{f.n}</b> × {f.diff}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Stats() {
  const [data, setData] = useState<StatsData | null>(null);
  const [prefs, setPrefs] = useState<PrefsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = statsQuery();
    let stopped = false;
    // The two endpoints refresh independently: one failing leaves the other live.
    const poll = async () => {
      const [stats, prefs] = await Promise.allSettled([fetchJson<StatsData>('/stats', query), fetchJson<PrefsData>('/prefs/summary', query)]);
      if (stopped) return;
      if (stats.status === 'fulfilled') setData(stats.value);
      if (prefs.status === 'fulfilled') setPrefs(prefs.value);
      const failed = [stats, prefs].find((r) => r.status === 'rejected');
      setError(failed ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : null);
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const totalRuns = data?.groups.reduce((n, g) => n + g.runs, 0) ?? 0;
  // Rows are (variant, slot) groups; the headline counts distinct variants.
  const variants = new Set(data?.groups.map((g) => g.variant)).size;
  const label = data ? windowLabel(data) : '';

  return (
    <div style={page}>
      <div style={title}>FLOTATO · STATS</div>
      {data && (
        <div style={subline}>
          {label}
          {label ? ' · ' : ''}
          {totalRuns} RUNS · {variants} VARIANTS
          {data.truncated ? ` · FIRST ${data.rows} ROWS ONLY` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: '2em', justifyContent: 'center', fontSize: '1.8vh', opacity: 0.75 }}>
        {DEATH_ORDER.map((d) => (
          <span key={d}>
            <span style={{ display: 'inline-block', width: '1.2em', height: '1.2em', verticalAlign: '-0.2em', marginRight: '0.5em', background: DEATH_COLOR[d] }} />
            {d}
          </span>
        ))}
      </div>

      <div>
        <div style={headRow}>
          {HEADERS.map((h) => (
            <span key={h} style={headCell}>
              {h}
            </span>
          ))}
        </div>
        {data && data.groups.length === 0 && <div style={{ ...row, display: 'block', opacity: 0.5 }}>no runs in the window</div>}
        {data?.groups.map((g) => (
          <div key={g.variant + ' ' + g.slot} style={row}>
            <span style={{ overflowWrap: 'anywhere', fontSize: '2vh', opacity: g.variant === 'default' ? 0.6 : 1 }}>{g.variant}</span>
            <span style={{ opacity: 0.6 }}>{g.slot}</span>
            <span style={{ fontWeight: 800 }}>{g.runs}</span>
            <span>{g.devices}</span>
            {pair(g.time.median, g.time.p90, 1)}
            {pair(g.reaction.median, g.reaction.p90, 2)}
            <span>{num(g.beatR)}</span>
            <span>{num(g.anticipation)}</span>
            <span>{num(g.countIn.r)}</span>
            <DeathBar deaths={g.deaths} runs={g.runs} />
          </div>
        ))}
      </div>

      {prefs && <Prefs prefs={prefs} />}

      <div style={footer}>{error ? 'board unreachable · ' + error : data ? 'live · refreshes every ' + POLL_MS / 1000 + 's' : 'loading'}</div>
    </div>
  );
}
