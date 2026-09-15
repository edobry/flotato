// Presets are diffs from default that stack, not exclusive modes: a name would
// become a lie the moment a slider moved. The diff string is the `?tune=`
// syntax, so a configuration is also a link.

import { DEFAULT_TUNING, type Tuning } from '../music/tuning';

export interface Chip {
  id: string;
  label: string;
  diff: Partial<Tuning>;
  /** Chips in the same row are alternatives and may share keys; rows are disjoint. */
  row?: string;
}

/**
 * Chips within one row share keys and are alternatives (the last tapped wins);
 * across rows the keys are disjoint, so rows stack in any order. The first
 * rows are the register's listening choices: tempo, scale, arp ceiling.
 */
export const CHIPS: Chip[] = [
  { row: 'tempo', id: 'tempo130', label: 'tempo 130 flat', diff: { bpmFloor: 130, bpmCeil: 130 } },
  { row: 'tempo', id: 'tempo140', label: 'tempo 140→150', diff: { bpmFloor: 140, bpmCeil: 150 } },
  { row: 'scale', id: 'dorian', label: 'dorian', diff: { scale: 'dorianHexatonic' } },
  { row: 'scale', id: 'wholeTone', label: 'whole tone', diff: { scale: 'wholeTone' } },
  { row: 'arp', id: 'arp8', label: 'arp 8ths only', diff: { arpCeiling: 'eighths' } },
  { row: 'arp', id: 'arp16', label: 'arp 16ths from entry', diff: { arpCeiling: 'sixteenths' } },
  { row: 'pump', id: 'noPump', label: 'no pump', diff: { pump: 0 } },
  { row: 'register', id: 'v1', label: 'register v1', diff: { register: 'v1', bpmFloor: 160, bpmCeil: 172, bpmRampSeconds: 40, scale: 'wholeTone', tension: 0.5, pump: 0 } },
  { id: 'metronome', label: 'metronome', diff: { reactivity: 0 } },
  { id: 'foreshadow', label: 'foreshadow', diff: { foreshadow: true } },
  { id: 'drone', label: 'drone death', diff: { deathMode: 'drone' } },
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
