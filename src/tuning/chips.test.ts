import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, applyTuneParam } from '../music/tuning';
import { CHIPS, chipActive, diffFromDefault, diffLabel, encodeDiff, toggleChip, tuneLink } from './chips';

const chip = (id: string) => CHIPS.find((c) => c.id === id)!;

describe('chips', () => {
  it('stack into one diff string in default-key order', () => {
    let t = { ...DEFAULT_TUNING };
    t = toggleChip(t, chip('noDrums'));
    t = toggleChip(t, chip('metronome'));
    expect(encodeDiff(diffFromDefault(t))).toBe('reactivity=0,drums=false');
    expect(chipActive(t, chip('metronome'))).toBe(true);
    expect(chipActive(t, chip('noDrums'))).toBe(true);
    expect(chipActive(t, chip('foreshadow'))).toBe(false);
  });

  it('encode then parse round-trips through the URL parser', () => {
    let t = { ...DEFAULT_TUNING };
    for (const c of CHIPS) t = toggleChip(t, c);
    const param = encodeDiff(diffFromDefault(t));
    expect(applyTuneParam({ ...DEFAULT_TUNING }, param)).toEqual(t);
  });

  it('toggling a chip off restores only its keys', () => {
    let t = { ...DEFAULT_TUNING, tension: 0.9 };
    t = toggleChip(t, chip('noDrums'));
    t = toggleChip(t, chip('noDrums'));
    expect(t.drums).toBe(true);
    expect(t.tension).toBe(0.9);
    expect(encodeDiff(diffFromDefault(t))).toBe('tension=0.9');
  });

  it('a slider change shows in the diff and unsets a chip whose key it moved', () => {
    let t = toggleChip({ ...DEFAULT_TUNING }, chip('metronome'));
    t = { ...t, reactivity: 0.3 };
    expect(chipActive(t, chip('metronome'))).toBe(false);
    expect(diffLabel(t)).toBe('reactivity=0.3');
    expect(diffLabel({ ...DEFAULT_TUNING })).toBe('default');
  });

  it('chip keys are disjoint', () => {
    const seen = new Set<string>();
    for (const c of CHIPS) for (const k of Object.keys(c.diff)) {
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('builds a readable link', () => {
    const t = toggleChip(toggleChip({ ...DEFAULT_TUNING }, chip('metronome')), chip('noDrums'));
    expect(tuneLink(t, 'https://example.test/flotato/?tune')).toBe('https://example.test/flotato/?tune=reactivity=0,drums=false');
    expect(tuneLink({ ...DEFAULT_TUNING }, 'https://example.test/flotato/')).toBe('https://example.test/flotato/?tune=');
  });
});
