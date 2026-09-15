// The A/B pair: two saved tunings to alternate between runs.

import type { Tuning } from '../music/tuning';
import type { Slot } from './runlog';

export interface Slots {
  A: Tuning | null;
  B: Tuning | null;
}

export const SLOTS_KEY = 'flotato.ab';

export function loadSlots(): Slots {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Slots>) : {};
    return { A: parsed.A ?? null, B: parsed.B ?? null };
  } catch {
    return { A: null, B: null };
  }
}

export function saveSlots(s: Slots): void {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function slotTuning(s: Slots, slot: Slot): Tuning | null {
  return slot === 'A' ? s.A : slot === 'B' ? s.B : null;
}
