import { useState } from 'react';
import { DEFAULT_TUNING, type Tuning } from './music/tuning';
import KnobInput from './KnobInput';

interface Props {
  tuning: Tuning;
  onChange: (t: Tuning) => void;
  onStop: () => void;
}

/** Knobs audible mid-run; start-time, visual and observer knobs live on the sheet. */
const OFF_STRIP: (keyof Tuning)[] = ['ghost', 'runStats', 'dangerOnset', 'beatPulse', 'beatOffsetMs', 'countInBars', 'randomStartOffset', 'milestones'];
const LIVE_KEYS = (Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]).filter((k) => !OFF_STRIP.includes(k));

/** During a ghost run on a phone: one knob at a time along the bottom edge; the canvas above stays the controller. */
export default function GhostStrip({ tuning, onChange, onStop }: Props) {
  const [key, setKey] = useState<keyof Tuning>('reactivity');
  return (
    <div className="strip" onPointerDown={(e) => e.stopPropagation()}>
      <div className="knobs">
        {LIVE_KEYS.map((k) => (
          <button key={k} type="button" className={'chip' + (k === key ? ' on' : '')} onClick={() => setKey(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="current">
        <KnobInput tuning={tuning} name={key} onChange={onChange} size="touch" />
        <button type="button" className="btn" onClick={onStop}>
          stop
        </button>
      </div>
    </div>
  );
}
