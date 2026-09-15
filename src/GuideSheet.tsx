// The guided listen on the phone: one comparison at a time, two buttons to
// hear the sides, a verdict, and at the end the discovered tuning to keep.

import { useState } from 'react';
import { diffLabel, tuneLink } from './tuning/chips';
import { describeTrail, estimatedSteps, guideTuning, type GuideState, type GuideStep, type Side, type Verdict } from './tuning/guide';

interface Props {
  state: GuideState;
  step: GuideStep | null;
  /** Which sides of the current step have been played at least once. */
  heard: Record<Side, boolean>;
  onPlay: (side: Side) => void;
  onVerdict: (verdict: Verdict) => void;
  onListen: (listen: boolean) => void;
  onUse: () => void;
  onRestart: () => void;
  onBack: () => void;
}

function copy(text: string, done: (ok: boolean) => void) {
  try {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  } catch {
    done(false);
  }
}

export default function GuideSheet({ state, step, heard, onPlay, onVerdict, onListen, onUse, onRestart, onBack }: Props) {
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('');
  const [fallback, setFallback] = useState('');
  const k = state.trail.length + 1;
  const n = estimatedSteps(state);
  const bothHeard = heard.A && heard.B;

  const head = (
    <div className="sheet-head">
      <span>GUIDED LISTEN</span>
      <button type="button" className="btn" onClick={onBack}>
        back to tuning
      </button>
    </div>
  );

  if (!step) {
    const final = guideTuning(state);
    const diff = diffLabel(final);
    return (
      <div className="sheet" onPointerDown={(e) => e.stopPropagation()}>
        {head}
        <h2>YOUR PICK</h2>
        <div className="diffline">
          <code>{diff}</code>
        </div>
        <div className="runs">
          {describeTrail(state).map((line, i) => (
            <div key={i} style={{ opacity: 0.75, lineHeight: 1.6 }}>
              {line}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={onUse}>
            use this
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const link = tuneLink(final, location.href);
              copy(link, (ok) => {
                setCopied(ok ? 'ok' : 'fail');
                setFallback(ok ? '' : link);
                setTimeout(() => setCopied(''), 1500);
              });
            }}
          >
            {copied === 'ok' ? 'copied' : copied === 'fail' ? 'copy failed' : 'copy link'}
          </button>
          <button type="button" className="btn" onClick={onRestart}>
            start over
          </button>
        </div>
        {fallback && <input className="fallback" readOnly value={fallback} onFocus={(e) => e.target.select()} />}
      </div>
    );
  }

  return (
    <div className="sheet" onPointerDown={(e) => e.stopPropagation()}>
      {head}
      <div style={{ opacity: 0.6, fontSize: 12, letterSpacing: 2, marginTop: 8 }}>
        {k} OF ~{n}
      </div>
      <p style={{ fontSize: 16, lineHeight: 1.5, margin: '10px 0 14px' }}>{step.ask}</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className={'btn' + (heard.A ? '' : ' primary')} style={{ flex: 1, padding: '16px 0' }} onClick={() => onPlay('A')}>
          play A · {step.aLabel}
        </button>
        <button type="button" className={'btn' + (heard.B || !heard.A ? '' : ' primary')} style={{ flex: 1, padding: '16px 0' }} onClick={() => onPlay('B')}>
          play B · {step.bLabel}
        </button>
      </div>
      <div style={{ opacity: 0.6, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
        {state.listen ? 'listening mode: nothing kills you; tap stop when you have heard enough' : 'playing mode: the run ends when you die'}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 13 }}>
        <input type="checkbox" checked={!state.listen} onChange={(e) => onListen(!e.target.checked)} />
        compare while actually playing
      </label>

      <h2>WHICH ONE?</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', opacity: bothHeard ? 1 : 0.4 }}>
        <button type="button" className="btn primary" disabled={!bothHeard} onClick={() => onVerdict('A')}>
          A
        </button>
        <button type="button" className="btn primary" disabled={!bothHeard} onClick={() => onVerdict('B')}>
          B
        </button>
        <button type="button" className="btn" disabled={!bothHeard} onClick={() => onVerdict('same')}>
          can't tell
        </button>
        <button type="button" className="btn" onClick={() => onVerdict('skip')}>
          skip
        </button>
      </div>
      {!bothHeard && <div style={{ opacity: 0.5, fontSize: 12, marginTop: 8 }}>hear both sides first</div>}

      {state.trail.length > 0 && (
        <>
          <h2>SO FAR</h2>
          <div className="runs">
            {describeTrail(state).map((line, i) => (
              <div key={i} style={{ opacity: 0.7, lineHeight: 1.6 }}>
                {line}
              </div>
            ))}
          </div>
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={onRestart}>
            start over
          </button>
        </>
      )}
    </div>
  );
}
