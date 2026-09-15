// Per-knob control metadata shared by the desktop panel, the tune sheet and the ghost strip.

import { DEATH_MODES, SCALE_NAMES, type Tuning } from '../music/tuning';

export type NumKey = { [K in keyof Tuning]: Tuning[K] extends number ? K : never }[keyof Tuning];

export const RANGES: Record<NumKey, [min: number, max: number, step: number]> = {
  reactivity: [0, 1, 0.05],
  bpmFloor: [90, 220, 1],
  bpmCeil: [90, 240, 1],
  bpmRampSeconds: [5, 120, 1],
  tension: [0, 1, 0.05],
  reward: [0, 1, 0.05],
  volume: [-30, 0, 1],
  beatOffsetMs: [-150, 300, 5],
  countInBars: [0, 4, 1],
  dangerOnset: [0, 0.8, 0.05],
};

export const ENUMS: Partial<Record<keyof Tuning, readonly string[]>> = {
  scale: SCALE_NAMES,
  deathMode: DEATH_MODES,
};

/** The first key of the player-observer group; a divider is drawn above it. */
export const OBSERVER_FROM: keyof Tuning = 'runStats';

export function setKnob(t: Tuning, key: keyof Tuning, value: unknown): Tuning {
  const next = { ...t } as Record<string, unknown>;
  next[key] = value;
  return next as unknown as Tuning;
}
