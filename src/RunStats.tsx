import type { CSSProperties } from 'react';
import type { RunSummary } from './player/observer';

const DASH = '—';

const block: CSSProperties = {
  marginTop: 18,
  fontSize: 13,
  lineHeight: 1.6,
  opacity: 0.6,
  textAlign: 'left',
  whiteSpace: 'pre',
};

const sec = (x: number) => x.toFixed(2) + 's';
const signed = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);

/** The run's loop metrics, one line per signal, for the game-over overlay. */
export default function RunStats({ run }: { run: RunSummary }) {
  const { reaction, anticipation, beat, loop } = run;
  const lines = [
    'react   ' + (reaction.n ? sec(reaction.median) + ' med  ' + sec(reaction.p90) + ' p90  n ' + reaction.n : DASH),
    'ahead   ' + (anticipation.n ? Math.round(anticipation.ratio * 100) + '%  n ' + anticipation.n : DASH),
    'beat    ' + (beat.n ? 'R ' + beat.r.toFixed(2) + '  ' + signed(beat.phase) + '  n ' + beat.n : DASH),
    'loop    ' + loop.overshoots + ' overshoot  ' + loop.reversals + ' reversal',
    'death   ' + run.death,
  ];
  return <div style={block}>{lines.join('\n')}</div>;
}
