import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../music/tuning';
import { V1_DIFF, applyVerdict, describeTrail, estimatedSteps, guideTuning, initialGuide, nextStep, sideTuning, type GuideState, type Verdict } from './guide';

/** Answer steps in order with the given verdicts; returns the state and the ids visited. */
function walk(verdicts: Verdict[], from: GuideState = initialGuide()): { state: GuideState; ids: string[] } {
  let state = from;
  const ids: string[] = [];
  for (const v of verdicts) {
    const step = nextStep(state);
    if (!step) break;
    ids.push(step.id);
    state = applyVerdict(state, step, v);
  }
  return { state, ids };
}

describe('the walk', () => {
  it('starts with old vs new and B is the whole v1 register', () => {
    const step = nextStep(initialGuide())!;
    expect(step.id).toBe('register');
    expect(sideTuning(initialGuide(), step, 'A')).toEqual(DEFAULT_TUNING);
    expect(sideTuning(initialGuide(), step, 'B')).toEqual({ ...DEFAULT_TUNING, ...V1_DIFF });
  });

  it('climbs the tempo ladder while faster keeps winning, at most twice', () => {
    const { state, ids } = walk(['A', 'B', 'B']);
    expect(ids).toEqual(['register', 'tempo-up', 'tempo-up-2']);
    expect(guideTuning(state).bpmFloor).toBe(DEFAULT_TUNING.bpmFloor + 20);
    expect(guideTuning(state).bpmCeil).toBe(DEFAULT_TUNING.bpmCeil + 20);
    expect(nextStep(state)!.id).toBe('scale-1');
  });

  it('tries slower when faster loses, and stops after a flip', () => {
    const { state, ids } = walk(['A', 'A', 'B', 'A']);
    expect(ids).toEqual(['register', 'tempo-up', 'tempo-down', 'tempo-down-2']);
    expect(guideTuning(state).bpmFloor).toBe(DEFAULT_TUNING.bpmFloor - 10);
    expect(nextStep(state)!.id).toBe('scale-1');
  });

  it('offers each other scale once, keeping the winner', () => {
    const { state, ids } = walk(['A', 'A', 'A', 'B', 'A']);
    expect(ids).toEqual(['register', 'tempo-up', 'tempo-down', 'scale-1', 'scale-2']);
    // scale-1 offered dorian (won), scale-2 offered whole tone (lost): dorian stays.
    expect(guideTuning(state).scale).toBe('dorianHexatonic');
    expect(nextStep(state)!.id).toBe('pump');
  });

  it('runs the v2-only steps only on v2, and skips arp-2 once sixteenths are chosen', () => {
    const v1 = walk(['B', 'A', 'A', 'A', 'A']);
    expect(v1.ids).toEqual(['register', 'tempo-up', 'tempo-down', 'scale-1', 'scale-2']);
    expect(nextStep(v1.state)!.id).toBe('reactivity');
    expect(estimatedSteps(v1.state)).toBe(7);

    const v2 = walk(['A', 'A', 'A', 'A', 'A', 'A', 'A', 'B']);
    expect(v2.ids.slice(-3)).toEqual(['pump', 'arp-1', 'arp-2']);
    expect(guideTuning(v2.state).arpCeiling).toBe('sixteenths');
    expect(estimatedSteps(v2.state)).toBe(10);
  });

  it("'same' and 'skip' keep the base and move on; the walk ends with null", () => {
    const { state } = walk(['same', 'skip', 'same', 'skip', 'same', 'skip', 'same', 'skip', 'same', 'skip']);
    expect(state.base).toEqual({});
    expect(nextStep(state)).toBeNull();
    expect(state.trail.map((t) => t.id)).toEqual(['register', 'tempo-up', 'tempo-down', 'scale-1', 'scale-2', 'pump', 'arp-1', 'arp-2', 'reactivity', 'drums']);
  });

  it('describes the trail in the step labels', () => {
    const { state } = walk(['A', 'B', 'same']);
    expect(describeTrail(state)).toEqual(['new vs old: new', 'as it is vs faster: faster', "as it is vs faster: couldn't tell"]);
  });

  it('replays to the same result from the trail alone', () => {
    const { state } = walk(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'A', 'B', 'A']);
    const replay = walk(state.trail.map((t) => t.verdict));
    expect(replay.state.base).toEqual(state.base);
  });
});
