import type { CSSProperties } from 'react';
import { DEFAULT_TUNING, type Tuning } from './music/tuning';
import { OBSERVER_FROM } from './tuning/controls';
import KnobInput from './KnobInput';

const panel: CSSProperties = {
  position: 'absolute',
  top: 'calc(44px + var(--sat))',
  left: 'calc(12px + var(--sal))',
  width: 260,
  maxHeight: 'calc(100dvh - 60px - var(--sat) - var(--sab))',
  overflowY: 'auto',
  padding: '10px 12px',
  background: 'rgba(0,0,0,0.78)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 6,
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.4,
  pointerEvents: 'auto',
  zIndex: 2,
};

interface Props {
  tuning: Tuning;
  onChange: (t: Tuning) => void;
  onReset: () => void;
}

/** The desktop side panel: every knob, compact, live while playing. */
export default function TuningOverlay({ tuning, onChange, onReset }: Props) {
  const keys = Object.keys(DEFAULT_TUNING) as (keyof Tuning)[];
  return (
    <div style={panel} className="panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="row" style={{ marginTop: 0 }}>
        <span style={{ fontWeight: 700 }}>TUNING</span>
        <span style={{ opacity: 0.6 }}>T hides · saved locally</span>
      </div>
      {keys.map((key) => (
        <div key={key}>
          {key === OBSERVER_FROM && <div className="row divider">player observer</div>}
          <KnobInput tuning={tuning} name={key} onChange={onChange} size="compact" />
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <span style={{ opacity: 0.6 }}>reactivity 0 = metronome</span>
        <button type="button" onClick={onReset}>
          reset
        </button>
      </div>
    </div>
  );
}
