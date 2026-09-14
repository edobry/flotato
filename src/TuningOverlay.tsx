import type { CSSProperties } from 'react';
import { DEATH_MODES, DEFAULT_TUNING, SCALE_NAMES, type Tuning } from './music/tuning';

type NumKey = { [K in keyof Tuning]: Tuning[K] extends number ? K : never }[keyof Tuning];

const RANGES: Record<NumKey, [min: number, max: number, step: number]> = {
  reactivity: [0, 1, 0.05],
  bpmFloor: [90, 220, 1],
  bpmCeil: [90, 240, 1],
  bpmRampSeconds: [5, 120, 1],
  tension: [0, 1, 0.05],
  reward: [0, 1, 0.05],
  volume: [-30, 0, 1],
  dangerOnset: [0, 0.8, 0.05],
};

/** The first key of the player-observer group; a divider is drawn above it. */
const OBSERVER_FROM: keyof Tuning = 'runStats';

const ENUMS: Partial<Record<keyof Tuning, readonly string[]>> = {
  scale: SCALE_NAMES,
  deathMode: DEATH_MODES,
};

const panel: CSSProperties = {
  position: 'absolute',
  top: 44,
  left: 12,
  width: 260,
  maxHeight: 'calc(100vh - 60px)',
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

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginTop: 6,
};

interface Props {
  tuning: Tuning;
  onChange: (t: Tuning) => void;
  onReset: () => void;
}

export default function TuningOverlay({ tuning, onChange, onReset }: Props) {
  const keys = Object.keys(DEFAULT_TUNING) as (keyof Tuning)[];
  const set = (key: keyof Tuning, value: unknown) => {
    const next = { ...tuning } as Record<string, unknown>;
    next[key] = value;
    onChange(next as unknown as Tuning);
  };

  return (
    <div style={panel} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ ...row, marginTop: 0 }}>
        <span style={{ fontWeight: 700 }}>TUNING</span>
        <span style={{ opacity: 0.6 }}>T hides · saved locally</span>
      </div>
      {keys.map((key) => {
        const value = tuning[key];
        const label = <span style={{ opacity: 0.85 }}>{key}</span>;
        const divider =
          key === OBSERVER_FROM ? (
            <div style={{ ...row, marginTop: 10, opacity: 0.6, borderTop: '1px solid rgba(255,255,255,0.18)', paddingTop: 6 }}>
              <span>player observer</span>
            </div>
          ) : null;
        if (typeof value === 'boolean') {
          return (
            <div key={key}>
              {divider}
              <label style={row}>
                {label}
                <input type="checkbox" checked={value} onChange={(e) => set(key, e.target.checked)} />
              </label>
            </div>
          );
        }
        if (typeof value === 'number') {
          const [min, max, step] = RANGES[key as NumKey];
          return (
            <label key={key} style={row}>
              {label}
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(e) => set(key, Number(e.target.value))}
                  style={{ width: 90 }}
                />
                <span style={{ width: 36, textAlign: 'right' }}>{value}</span>
              </span>
            </label>
          );
        }
        const options = ENUMS[key] ?? [String(value)];
        return (
          <label key={key} style={row}>
            {label}
            <select value={String(value)} onChange={(e) => set(key, e.target.value)}>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <div style={{ ...row, marginTop: 10 }}>
        <span style={{ opacity: 0.6 }}>reactivity 0 = metronome</span>
        <button type="button" onClick={onReset}>
          reset
        </button>
      </div>
    </div>
  );
}
