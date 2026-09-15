// The room's view of Flotato, meant for a projector: a QR code to play, the
// top runs, what just happened, and the room's numbers. Polls the board
// Worker; no interaction needed.

import { useEffect, useState, type CSSProperties } from 'react';
import { BOARD_URL, PLAY_URL } from '../config';

const POLL_MS = 3000;
const QR_SRC = import.meta.env.BASE_URL + 'qr.svg';
const DASH = '—';

interface Entry {
  tag: string;
  time: number;
  death: string;
  at: number;
}

interface Stats {
  runs: number;
  devices: number;
  best: number | null;
  reactionMedian: number | null;
  beatR: number | null;
  deaths: Record<string, number>;
}

interface BoardData {
  hours: number;
  top: Entry[];
  feed: Entry[];
  stats: Stats;
}

function readParams(): { limit: number; hours: number } {
  try {
    const p = new URLSearchParams(location.search);
    return { limit: Number(p.get('limit')) || 10, hours: Number(p.get('hours')) || 12 };
  } catch {
    return { limit: 10, hours: 12 };
  }
}

const page: CSSProperties = {
  minHeight: '100vh',
  background: '#000',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  display: 'grid',
  gridTemplateColumns: '1fr 1.2fr 1fr',
  gridTemplateRows: 'auto 1fr auto',
  gap: '2vw',
  padding: '3vh 3vw',
  boxSizing: 'border-box',
};

const title: CSSProperties = { gridColumn: '1 / -1', fontSize: '4.5vh', fontWeight: 800, letterSpacing: '0.35em', textAlign: 'center' };
const heading: CSSProperties = { fontSize: '2vh', letterSpacing: '0.25em', opacity: 0.55, marginBottom: '1.5vh' };
const row: CSSProperties = { display: 'grid', gridTemplateColumns: '2.2em 3.5em 1fr auto', gap: '0.8em', fontSize: '3.2vh', lineHeight: 1.45, alignItems: 'baseline' };
const feedRow: CSSProperties = { ...row, gridTemplateColumns: '3.5em 1fr auto', fontSize: '2.6vh', opacity: 0.8 };
const stat: CSSProperties = { fontSize: '2.6vh', lineHeight: 1.7 };
const footer: CSSProperties = { gridColumn: '1 / -1', fontSize: '1.8vh', opacity: 0.45, textAlign: 'center', letterSpacing: '0.1em' };

const ago = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? s + 's' : Math.round(s / 60) + 'm';
};
const pct = (n: number, total: number) => (total ? Math.round((100 * n) / total) + '%' : DASH);

export default function Board() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const hue = 195;

  useEffect(() => {
    const { limit, hours } = readParams();
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`${BOARD_URL}/board?limit=${limit}&hours=${hours}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('board answered ' + res.status);
        const next = (await res.json()) as BoardData;
        if (!stopped) {
          setData(next);
          setError(null);
          setNow(Date.now());
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const accent = { color: `hsl(${hue}, 85%, 62%)` };
  const stats = data?.stats;
  const deaths = stats?.deaths ?? {};
  const deathOrder = ['late', 'freeze', 'overshoot', 'jitter', 'wrong way'];

  return (
    <div style={page}>
      <div style={title}>FLOTATO</div>

      <section>
        <div style={heading}>PLAY</div>
        <img src={QR_SRC} alt={'QR code for ' + PLAY_URL} style={{ width: '100%', maxWidth: '38vh', display: 'block', imageRendering: 'pixelated' }} />
        <div style={{ marginTop: '1.5vh', fontSize: '2vh', opacity: 0.7, overflowWrap: 'anywhere' }}>{PLAY_URL.replace('https://', '')}</div>
        <div style={{ marginTop: '1vh', fontSize: '1.8vh', opacity: 0.5 }}>hold left or right · survive · the beat drives you</div>
      </section>

      <section>
        <div style={heading}>TOP {data ? `· LAST ${data.hours}H` : ''}</div>
        {data && data.top.length === 0 && <div style={{ ...stat, opacity: 0.5 }}>no runs yet</div>}
        {data?.top.map((e, i) => (
          <div key={e.at + e.tag + i} style={row}>
            <span style={{ opacity: 0.5 }}>{i + 1}</span>
            <span style={{ fontWeight: 800, ...accent }}>{e.tag}</span>
            <span>{e.time.toFixed(2)}</span>
            <span style={{ opacity: 0.5, fontSize: '2.2vh' }}>{e.death}</span>
          </div>
        ))}
      </section>

      <section>
        <div style={heading}>THE ROOM</div>
        {stats && (
          <div style={stat}>
            <div>
              <span style={accent}>{stats.runs}</span> runs · <span style={accent}>{stats.devices}</span> players
            </div>
            <div>
              best <span style={accent}>{stats.best === null ? DASH : stats.best.toFixed(2)}</span>
            </div>
            <div>
              react <span style={accent}>{stats.reactionMedian === null ? DASH : stats.reactionMedian.toFixed(2) + 's'}</span> median
            </div>
            <div>
              on beat <span style={accent}>{stats.beatR === null ? DASH : 'R ' + stats.beatR.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: '1.5vh', opacity: 0.75, fontSize: '2.2vh', lineHeight: 1.6 }}>
              {deathOrder.map((d) => (
                <div key={d}>
                  {d.padEnd(10, ' ')} {pct(deaths[d] ?? 0, stats.runs)}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ ...heading, marginTop: '3vh' }}>JUST NOW</div>
        {data?.feed.slice(0, 6).map((e, i) => (
          <div key={e.at + e.tag + 'f' + i} style={feedRow}>
            <span style={{ fontWeight: 800 }}>{e.tag}</span>
            <span>
              {e.time.toFixed(2)} <span style={{ opacity: 0.5 }}>{e.death}</span>
            </span>
            <span style={{ opacity: 0.4 }}>{ago(e.at, now)}</span>
          </div>
        ))}
      </section>

      <div style={footer}>{error ? 'board unreachable · ' + error : data ? 'live · refreshes every ' + POLL_MS / 1000 + 's' : 'loading'}</div>
    </div>
  );
}
