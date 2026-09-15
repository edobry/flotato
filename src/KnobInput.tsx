import { ENUMS, RANGES, setKnob, type NumKey } from './tuning/controls';
import type { Tuning } from './music/tuning';

interface Props {
  tuning: Tuning;
  name: keyof Tuning;
  onChange: (t: Tuning) => void;
  /** `touch` lays the control out full-width under its label at thumb size. */
  size: 'compact' | 'touch';
}

/** One tuning knob, rendered by its value's type: checkbox, range, or select. */
export default function KnobInput({ tuning, name, onChange, size }: Props) {
  const value = tuning[name];
  const touch = size === 'touch';
  const set = (v: unknown) => onChange(setKnob(tuning, name, v));
  if (typeof value === 'boolean') {
    return (
      <label className={touch ? 'knob knob-row' : 'row'}>
        <span className="knob-name">{name}</span>
        <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      </label>
    );
  }
  if (typeof value === 'number') {
    const [min, max, step] = RANGES[name as NumKey];
    const range = <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />;
    if (touch) {
      return (
        <div className="knob">
          <div className="knob-row">
            <span className="knob-name">{name}</span>
            <span>{value}</span>
          </div>
          {range}
        </div>
      );
    }
    return (
      <label className="row">
        <span className="knob-name">{name}</span>
        <span className="row-value">
          {range}
          <span className="row-num">{value}</span>
        </span>
      </label>
    );
  }
  const options = ENUMS[name] ?? [String(value)];
  return (
    <label className={touch ? 'knob knob-row' : 'row'}>
      <span className="knob-name">{name}</span>
      <select value={String(value)} onChange={(e) => set(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
