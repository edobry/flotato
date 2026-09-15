// Presets are diffs from default that stack, not exclusive modes: a name would
// become a lie the moment a slider moved. The diff string is the `?tune=`
// syntax, so a configuration is also a link.

import { DEFAULT_TUNING, type Tuning } from '../music/tuning';

export interface Chip {
  id: string;
  label: string;
  diff: Partial<Tuning>;
}

/** Keys across chips are disjoint, so stacking order does not matter. */
export const CHIPS: Chip[] = [
  { id: 'metronome', label: 'metronome', diff: { reactivity: 0 } },
  { id: 'foreshadow', label: 'foreshadow', diff: { foreshadow: true } },
  { id: 'drone', label: 'drone death', diff: { deathMode: 'drone' } },
  { id: 'minorHex', label: 'minor hex', diff: { scale: 'minorHexatonic' } },
  { id: 'noDrums', label: 'no drums', diff: { drums: false } },
];

const keysOf = (diff: Partial<Tuning>) => Object.keys(diff) as (keyof Tuning)[];

export function chipActive(t: Tuning, chip: Chip): boolean {
  return keysOf(chip.diff).every((k) => t[k] === chip.diff[k]);
}

/** Apply the chip, or when it is fully active, restore the defaults for its keys. */
export function toggleChip(t: Tuning, chip: Chip): Tuning {
  const next = { ...t } as Record<string, unknown>;
  const on = chipActive(t, chip);
  for (const k of keysOf(chip.diff)) next[k] = on ? DEFAULT_TUNING[k] : chip.diff[k];
  return next as unknown as Tuning;
}

/** Keys whose value differs from the default, in default-key order. */
export function diffFromDefault(t: Tuning): Partial<Tuning> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]) {
    if (t[k] !== DEFAULT_TUNING[k]) out[k] = t[k];
  }
  return out as Partial<Tuning>;
}

/** `key=value,key=value` as the URL parser reads it; empty for a default tuning. */
export function encodeDiff(diff: Partial<Tuning>): string {
  return (Object.keys(diff) as (keyof Tuning)[]).map((k) => k + '=' + String(diff[k])).join(',');
}

/** The diff string for display: `default` when nothing differs. */
export function diffLabel(t: Tuning): string {
  return encodeDiff(diffFromDefault(t)) || 'default';
}

export function tuneLink(t: Tuning, href: string): string {
  const url = new URL(href);
  const diff = encodeDiff(diffFromDefault(t));
  url.searchParams.set('tune', diff);
  // URLSearchParams escapes '=' and ','; the parser accepts both, but the bare form is the one people read.
  return url.toString().replace(/tune=[^&#]*/, 'tune=' + diff);
}
