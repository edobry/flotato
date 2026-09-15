import { describe, expect, it } from 'vitest';
import { offsetBeatPhase } from './beat';

describe('offsetBeatPhase', () => {
  it('shifts the phase back by the latency in beats', () => {
    // 160 BPM: one beat is 0.375s, so 75ms is 0.2 beat.
    expect(offsetBeatPhase(0.5, 160, 0.075)).toBeCloseTo(0.3, 6);
  });

  it('wraps at the beat boundary in both directions', () => {
    expect(offsetBeatPhase(0.1, 160, 0.075)).toBeCloseTo(0.9, 6);
    expect(offsetBeatPhase(0.95, 160, -0.075)).toBeCloseTo(0.15, 6);
    expect(offsetBeatPhase(0, 120, 0.5)).toBeCloseTo(0, 6); // exactly one beat
  });

  it('passes a stopped transport and bad inputs through', () => {
    expect(offsetBeatPhase(-1, 160, 0.1)).toBe(-1);
    expect(offsetBeatPhase(0.4, 0, 0.1)).toBe(0.4);
    expect(offsetBeatPhase(0.4, 160, NaN)).toBe(0.4);
  });
});
