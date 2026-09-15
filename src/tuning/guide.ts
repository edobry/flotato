// The guided listen: an adaptive walk of pairwise comparisons that discovers
// a preference without asking for a single musical term. Each step offers
// two tunings, A ("as it is now") and B ("one thing changed"); the verdict
// folds the winner into the base and decides the next pair. Pure: the sheet
// plays the sides and reports verdicts; the base is a diff from DEFAULT_TUNING,
// so the result is also a `?tune=` link.

import { DEFAULT_TUNING, type Tuning } from '../music/tuning';
import type { ScaleName } from '../music/scale';

export type Verdict = 'A' | 'B' | 'same' | 'skip';
export type Side = 'A' | 'B';

export interface GuideStep {
  id: string;
  /** The question, in plain words. */
  ask: string;
  aLabel: string;
  bLabel: string;
  a: Partial<Tuning>;
  b: Partial<Tuning>;
}

export interface GuideState {
  /** Preferences so far, as a diff from the defaults. */
  base: Partial<Tuning>;
  trail: { id: string; verdict: Verdict }[];
  /** Ghost mode for the guide's runs: listen without dying. */
  listen: boolean;
}

export const GUIDE_KEY = 'flotato.guide';
const TEMPO_STEP = 10;
const SCALES: ScaleName[] = ['minorHexatonic', 'dorianHexatonic', 'wholeTone'];
const SCALE_WORDS: Record<ScaleName, string> = {
  minorHexatonic: 'darker, grounded',
  dorianHexatonic: 'a shade brighter',
  wholeTone: 'floating, unresolved',
  majorPentatonic: 'bright',
};

/** The previous register, as one diff, so the walk can start from "old or new". */
export const V1_DIFF: Partial<Tuning> = { register: 'v1', bpmFloor: 160, bpmCeil: 172, bpmRampSeconds: 40, scale: 'wholeTone', tension: 0.5, pump: 0 };

export function initialGuide(): GuideState {
  return { base: {}, trail: [], listen: true };
}

export function guideTuning(state: GuideState, extra: Partial<Tuning> = {}): Tuning {
  return { ...DEFAULT_TUNING, ...state.base, ...extra };
}

export function sideTuning(state: GuideState, step: GuideStep, side: Side): Tuning {
  return guideTuning(state, side === 'A' ? step.a : step.b);
}

const verdictOf = (state: GuideState, id: string): Verdict | undefined => state.trail.find((t) => t.id === id)?.verdict;
const done = (state: GuideState, id: string) => verdictOf(state, id) !== undefined;

function tempoStep(state: GuideState, id: string, delta: number): GuideStep {
  const t = guideTuning(state);
  const faster = delta > 0;
  return {
    id,
    ask: faster ? 'Same music, a little faster in B.' : 'Same music, a little slower in B.',
    aLabel: 'as it is',
    bLabel: faster ? 'faster' : 'slower',
    a: {},
    b: { bpmFloor: t.bpmFloor + delta, bpmCeil: t.bpmCeil + delta },
  };
}

function firstOther(current: ScaleName, exclude: ScaleName[]): ScaleName | null {
  return SCALES.find((s) => s !== current && !exclude.includes(s)) ?? null;
}

/** The next comparison, or null when the walk is complete. */
export function nextStep(state: GuideState): GuideStep | null {
  const t = guideTuning(state);
  const v2 = t.register === 'v2';

  if (!done(state, 'register')) {
    return {
      id: 'register',
      ask: 'Two versions of the music. A is the new one, B is the old one.',
      aLabel: 'new',
      bLabel: 'old',
      a: {},
      b: V1_DIFF,
    };
  }

  // Tempo ladder: try faster; if that wins, faster again; otherwise try slower, and slower again if that wins.
  if (!done(state, 'tempo-up')) return tempoStep(state, 'tempo-up', TEMPO_STEP);
  if (verdictOf(state, 'tempo-up') === 'B') {
    if (!done(state, 'tempo-up-2')) return tempoStep(state, 'tempo-up-2', TEMPO_STEP);
  } else {
    if (!done(state, 'tempo-down')) return tempoStep(state, 'tempo-down', -TEMPO_STEP);
    if (verdictOf(state, 'tempo-down') === 'B' && !done(state, 'tempo-down-2')) return tempoStep(state, 'tempo-down-2', -TEMPO_STEP);
  }

  // Scale: the current one against each of the other two, one at a time.
  if (!done(state, 'scale-1')) {
    const s = scaleStepFor(state, 'scale-1', []);
    if (s) return s;
  } else if (!done(state, 'scale-2')) {
    const heard = scaleHeard(state);
    const s = scaleStepFor(state, 'scale-2', heard);
    if (s) return s;
  }

  if (v2) {
    if (!done(state, 'pump')) {
      return {
        id: 'pump',
        ask: 'Same music; in B the bass and pad stop breathing with the kick.',
        aLabel: 'pulsing',
        bLabel: 'flat',
        a: {},
        b: { pump: 0 },
      };
    }
    if (!done(state, 'arp-1')) {
      return {
        id: 'arp-1',
        ask: 'Same music; in B the fast notes never double up, they stay unhurried the whole run.',
        aLabel: 'as it is',
        bLabel: 'unhurried',
        a: {},
        b: { arpCeiling: 'eighths' },
      };
    }
    if (!done(state, 'arp-2') && t.arpCeiling !== 'sixteenths') {
      return {
        id: 'arp-2',
        ask: 'Same music; in B the fast notes are busy from the moment they enter.',
        aLabel: 'as it is',
        bLabel: 'busy from the start',
        a: {},
        b: { arpCeiling: 'sixteenths' },
      };
    }
  }

  if (!done(state, 'reactivity') && t.reactivity > 0) {
    return {
      id: 'reactivity',
      ask: 'Same music; in B it stops reacting to what you do (the Super Hexagon way).',
      aLabel: 'reacts to you',
      bLabel: 'just plays',
      a: {},
      b: { reactivity: 0 },
    };
  }

  if (!done(state, 'drums') && t.drums) {
    return {
      id: 'drums',
      ask: 'Same music, without the drums in B.',
      aLabel: 'drums',
      bLabel: 'no drums',
      a: {},
      b: { drums: false },
    };
  }

  return null;
}

/** Scales already offered as B in earlier scale steps, so they are not offered twice. */
function scaleHeard(state: GuideState): ScaleName[] {
  const heard: ScaleName[] = [];
  // Replay the trail to recover which scale each step offered.
  let replay = initialGuide();
  for (const s of state.trail) {
    const step = nextStep(replay);
    if (!step) break;
    if (step.id.startsWith('scale') && step.b.scale) heard.push(step.b.scale);
    replay = applyVerdict(replay, step, s.verdict);
  }
  return heard;
}

function scaleStepFor(state: GuideState, id: string, exclude: ScaleName[]): GuideStep | null {
  const t = guideTuning(state);
  const candidate = firstOther(t.scale, exclude);
  if (!candidate) return null;
  return {
    id,
    ask: `Same music, a different set of notes in B (${SCALE_WORDS[candidate]}).`,
    aLabel: 'as it is',
    bLabel: SCALE_WORDS[candidate],
    a: {},
    b: { scale: candidate },
  };
}

export function applyVerdict(state: GuideState, step: GuideStep, verdict: Verdict): GuideState {
  const base = verdict === 'A' ? { ...state.base, ...step.a } : verdict === 'B' ? { ...state.base, ...step.b } : state.base;
  return { ...state, base, trail: state.trail.concat({ id: step.id, verdict }) };
}

/** Roughly how many comparisons the walk has, for "k of ~n". */
export function estimatedSteps(state: GuideState): number {
  const v2 = guideTuning(state).register === 'v2';
  return 1 + 2 + 2 + (v2 ? 3 : 0) + 1 + 1;
}

/** The trail in words, for the summary. */
export function describeTrail(state: GuideState): string[] {
  const words: string[] = [];
  let replay = initialGuide();
  for (const s of state.trail) {
    const step = nextStep(replay);
    if (!step) break;
    const pick = s.verdict === 'A' ? step.aLabel : s.verdict === 'B' ? step.bLabel : s.verdict === 'same' ? "couldn't tell" : 'skipped';
    words.push(`${step.aLabel} vs ${step.bLabel}: ${pick}`);
    replay = applyVerdict(replay, step, s.verdict);
  }
  return words;
}

export function loadGuide(): GuideState {
  try {
    const raw = localStorage.getItem(GUIDE_KEY);
    if (!raw) return initialGuide();
    const parsed = JSON.parse(raw) as Partial<GuideState>;
    return {
      base: parsed.base && typeof parsed.base === 'object' ? parsed.base : {},
      trail: Array.isArray(parsed.trail) ? parsed.trail : [],
      listen: parsed.listen !== false,
    };
  } catch {
    return initialGuide();
  }
}

export function saveGuide(state: GuideState): void {
  try {
    localStorage.setItem(GUIDE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

export function clearGuide(): void {
  try {
    localStorage.removeItem(GUIDE_KEY);
  } catch {
    /* storage unavailable */
  }
}
