import { useState } from 'react';
import { DEFAULT_TUNING, type Tuning } from './music/tuning';
import { CHIPS, chipActive, diffLabel, toggleChip, tuneLink } from './tuning/chips';
import { OBSERVER_FROM } from './tuning/controls';
import { groupRuns, type RunRecord, type Slot } from './tuning/runlog';
import type { Slots } from './tuning/slots';
import KnobInput from './KnobInput';

interface Props {
  tuning: Tuning;
  onChange: (t: Tuning) => void;
  onReset: () => void;
  /** The device's best time, which `onReset` leaves alone; `onResetBest` clears it. */
  best: number;
  onResetBest: () => void;
  slots: Slots;
  onSetSlot: (slot: 'A' | 'B') => void;
  runs: RunRecord[];
  onClearRuns: () => void;
  onPlay: (slot: Slot) => void;
  onClose: () => void;
  onGuide: () => void;
}

function copy(text: string, done: (ok: boolean) => void) {
  try {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  } catch {
    done(false);
  }
}

/** Between runs: chips, the A/B pair, every knob at thumb size, and the run log. */
export default function TuneSheet({ tuning, onChange, onReset, best, onResetBest, slots, onSetSlot, runs, onClearRuns, onPlay, onClose, onGuide }: Props) {
  const [copied, setCopied] = useState<'' | 'link' | 'json' | 'fail'>('');
  // When the clipboard is unavailable (no secure context, permission denied), show the text to select by hand.
  const [fallback, setFallback] = useState('');
  const keys = Object.keys(DEFAULT_TUNING) as (keyof Tuning)[];
  const groups = groupRuns(runs);
  const flash = (what: 'link' | 'json', text: string) => (ok: boolean) => {
    setCopied(ok ? what : 'fail');
    setFallback(ok ? '' : text);
    setTimeout(() => setCopied(''), 1500);
  };
  const slotRow = (name: 'A' | 'B') => {
    const t = slots[name];
    return (
      <div className="slot">
        <span style={{ fontWeight: 700, width: 16 }}>{name}</span>
        <code>{t ? diffLabel(t) : '—'}</code>
        <button type="button" className="btn" onClick={() => onSetSlot(name)}>
          set {name}
        </button>
        <button type="button" className="btn" disabled={!t} onClick={() => onPlay(name)}>
          play {name}
        </button>
      </div>
    );
  };

  return (
    <div className="sheet" onPointerDown={(e) => e.stopPropagation()}>
      <div className="sheet-head">
        <span>TUNING</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={onGuide}>
            guide me
          </button>
          <button type="button" className="btn" onClick={onClose}>
            close
          </button>
        </span>
      </div>

      <div className="chips">
        {CHIPS.map((c) => (
          <button key={c.id} type="button" className={'chip' + (chipActive(tuning, c) ? ' on' : '')} onClick={() => onChange(toggleChip(tuning, c))}>
            {c.label}
          </button>
        ))}
        <button type="button" className={'chip' + (tuning.ghost ? ' on' : '')} onClick={() => onChange({ ...tuning, ghost: !tuning.ghost })}>
          ghost mode
        </button>
      </div>
      <div className="diffline">
        <code>{diffLabel(tuning)}</code>
        <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const link = tuneLink(tuning, location.href);
              copy(link, flash('link', link));
            }}
          >
            {copied === 'link' ? 'copied' : copied === 'fail' ? 'copy failed' : 'copy link'}
          </button>
          <button type="button" className="btn" onClick={onReset}>
            reset
          </button>
        </span>
      </div>

      <h2>A / B</h2>
      {slotRow('A')}
      {slotRow('B')}

      <h2>KNOBS</h2>
      {keys.map((key) => (
        <div key={key}>
          {key === OBSERVER_FROM && <h2>PLAYER OBSERVER</h2>}
          <KnobInput tuning={tuning} name={key} onChange={onChange} size="touch" />
        </div>
      ))}

      <h2>RUNS</h2>
      <div className="runs">
        {groups.length === 0 ? (
          <div style={{ opacity: 0.6 }}>none yet — runs log here when you die outside ghost mode</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>config</th>
                <th className="num">n</th>
                <th className="num">median</th>
                <th className="num">best</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.diff}>
                  <td>
                    <code>{g.diff}</code>
                  </td>
                  <td className="num">{g.n}</td>
                  <td className="num">{g.median.toFixed(2)}</td>
                  <td className="num">{g.best.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="btn"
            disabled={runs.length === 0}
            onClick={() => {
              const json = JSON.stringify(runs);
              copy(json, flash('json', json));
            }}
          >
            {copied === 'json' ? 'copied' : 'copy JSON'}
          </button>
          <button type="button" className="btn" disabled={runs.length === 0} onClick={onClearRuns}>
            clear
          </button>
          <button type="button" className="btn" disabled={best === 0} onClick={onResetBest} style={{ marginLeft: 'auto' }}>
            reset best{best > 0 ? ' ' + best.toFixed(2) : ''}
          </button>
        </div>
      </div>

      {fallback && <input className="fallback" readOnly value={fallback} onFocus={(e) => e.target.select()} />}

      <div className="sheet-foot">
        <button type="button" className="btn primary" onClick={() => onPlay('')}>
          play
        </button>
      </div>
    </div>
  );
}
