// One record per completed (non-ghost) run in tune mode, so an A/B comparison
// is numbers rather than impressions. Bounded; newest last.

import type { Tuning } from '../music/tuning';
import type { RunSummary } from '../player/observer';

export type Slot = 'A' | 'B' | '';

export interface RunRecord {
  /** Wall-clock ms at death. */
  at: number;
  /** Survival seconds. */
  time: number;
  /** The diff string in force, or `default`. */
  diff: string;
  slot: Slot;
  tuning: Tuning;
  summary?: RunSummary;
}

export interface RunGroup {
  diff: string;
  n: number;
  median: number;
  best: number;
}

export const RUN_LOG_KEY = 'flotato.runs';
export const RUN_LOG_CAP = 300;

export function appendRun(runs: RunRecord[], rec: RunRecord, cap = RUN_LOG_CAP): RunRecord[] {
  const out = runs.concat(rec);
  return out.length > cap ? out.slice(out.length - cap) : out;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Groups in order of first appearance. */
export function groupRuns(runs: RunRecord[]): RunGroup[] {
  const times = new Map<string, number[]>();
  for (const r of runs) {
    const list = times.get(r.diff);
    if (list) list.push(r.time);
    else times.set(r.diff, [r.time]);
  }
  const out: RunGroup[] = [];
  for (const [diff, list] of times) {
    const sorted = list.slice().sort((a, b) => a - b);
    out.push({ diff, n: sorted.length, median: median(sorted), best: sorted[sorted.length - 1] });
  }
  return out;
}

export function loadRuns(): RunRecord[] {
  try {
    const raw = localStorage.getItem(RUN_LOG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: RunRecord[]): void {
  try {
    localStorage.setItem(RUN_LOG_KEY, JSON.stringify(runs));
  } catch {
    /* storage unavailable */
  }
}

export function clearRuns(): void {
  try {
    localStorage.removeItem(RUN_LOG_KEY);
  } catch {
    /* storage unavailable */
  }
}
