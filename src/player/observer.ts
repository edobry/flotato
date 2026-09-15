// The player observer: a second consumer of the per-frame snapshot the music
// engine reads. It watches how the player's input relates to the walls and
// the beat and reduces a run to a handful of loop metrics for the game-over
// screen. It changes nothing about the game and holds only bounded state.
//
// Vocabulary. An input onset is rotDir going from 0 to ±1 between frames; a
// release is the reverse; a reversal is a direct sign flip, or an onset of the
// opposite sign within `reversalGap` of a release. A threat episode starts
// when lane danger crosses above `dangerOnset` and ends when the lane is
// clear again or the run does. It is wall-caused when the sector did not
// change that frame (the wall came to the player) and self-caused when it did
// (the player rotated into it). Only wall-caused episodes measure reaction.

import type { Snapshot } from '../music/engine';

export interface ObserverConfig {
  /** Lane danger crossing above this is a threat onset. */
  dangerOnset: number;
  /** An onset this soon after a release of the opposite sign is a reversal. */
  reversalGap: number;
  /** A self-caused onset from a clear lane followed by a reversal within this window is an overshoot. */
  overshootWindow: number;
  /** A death this soon after rotating into the killing lane from a clear one is an overshoot. */
  overshootAtDeath: number;
  /** A death with at least `jitterReversals` reversals in the final `jitterWindow` seconds is jitter. */
  jitterWindow: number;
  jitterReversals: number;
}

export const DEFAULT_OBSERVER_CONFIG: ObserverConfig = {
  dangerOnset: 0,
  reversalGap: 0.1,
  overshootWindow: 0.4,
  overshootAtDeath: 0.5,
  jitterWindow: 0.8,
  jitterReversals: 2,
};

export type DeathClass = 'jitter' | 'overshoot' | 'wrong way' | 'freeze' | 'late';

export interface RunSummary {
  /** Survival time in seconds. */
  time: number;
  /** Seconds from a wall-caused onset to the first input, over episodes the player was still in at onset. */
  reaction: { median: number; p90: number; n: number };
  /** Input onsets made while the lane was clear, over all input onsets. */
  anticipation: { ratio: number; n: number };
  /** Circular statistics of input onsets against the beat: resultant length and mean phase in (-0.5, 0.5]. */
  beat: { r: number; phase: number; n: number };
  loop: { overshoots: number; reversals: number };
  death: DeathClass;
}

export interface Observer {
  start(): void;
  /**
   * Once per frame, after the snapshot is written. beatPhase is read only at an
   * input onset; it returns 0..1 within the beat, or -1 when the Transport is not running.
   */
  frame(s: Snapshot, beatPhase: () => number): void;
  /** At the collision, after the death frame was passed to frame(). */
  die(): RunSummary;
  /** Takes effect at the next start(), so one run's metrics use one configuration. */
  configure(c: Partial<ObserverConfig>): void;
}

const SIDES = 6;
const TAU = Math.PI * 2;

interface Episode {
  onset: number;
  cause: 'wall' | 'self';
  /** For self-caused episodes: the lane just left was clear. */
  fromClear: boolean;
  /** rotDir was nonzero at onset; the response is not measured. */
  movingAtOnset: boolean;
  edges: number;
}

/** Steps in direction `dir` to the nearest lane at or below the onset threshold, or Infinity. */
function stepsToClear(lanes: number[], sector: number, dir: number, onset: number): number {
  for (let k = 1; k < SIDES; k++) {
    if ((lanes[(((sector + dir * k) % SIDES) + SIDES) % SIDES] ?? 0) <= onset) return k;
  }
  return Infinity;
}

/** Nearest-rank percentile of a sorted array. */
function rank(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function createObserver(initial: Partial<ObserverConfig> = {}): Observer {
  const next: ObserverConfig = { ...DEFAULT_OBSERVER_CONFIG, ...initial };
  const cfg: ObserverConfig = { ...next };

  let t = 0;
  let prevSector = 0;
  let prevRotDir = 0;
  let prevAbove = false;
  let started = false;
  let episode: Episode | null = null;
  /** When the current unbroken stretch of threat began, across self-caused episode transitions. */
  let threatStart = -1;
  /** The last release, for reversal-through-zero. */
  let releaseDir = 0;
  let releaseT = -Infinity;
  /** The last self-caused entry from a clear lane, for overshoots. */
  let clearEntryT = -Infinity;
  /** The last edge: what it was and, for an onset, whether it went the long way to safety. */
  let lastEdge: 'onset' | 'release' | 'reversal' | null = null;
  let lastOnsetT = -Infinity;
  let lastOnsetWrong = false;

  const latencies: number[] = [];
  let onsetsAll = 0;
  let onsetsClear = 0;
  let sumCos = 0;
  let sumSin = 0;
  let nBeat = 0;
  let overshoots = 0;
  let reversals = 0;
  /** Recent reversal times, pruned to the jitter window. */
  const recentReversals: number[] = [];

  function reset() {
    t = 0;
    prevSector = 0;
    prevRotDir = 0;
    prevAbove = false;
    episode = null;
    threatStart = -1;
    releaseDir = 0;
    releaseT = -Infinity;
    clearEntryT = -Infinity;
    lastEdge = null;
    lastOnsetT = -Infinity;
    lastOnsetWrong = false;
    latencies.length = 0;
    onsetsAll = 0;
    onsetsClear = 0;
    sumCos = 0;
    sumSin = 0;
    nBeat = 0;
    overshoots = 0;
    reversals = 0;
    recentReversals.length = 0;
  }

  function noteReversal() {
    reversals++;
    recentReversals.push(t);
    while (recentReversals.length && t - recentReversals[0] > cfg.jitterWindow) recentReversals.shift();
    if (t - clearEntryT <= cfg.overshootWindow) {
      overshoots++;
      clearEntryT = -Infinity;
    }
  }

  function noteEdge() {
    if (!episode) return;
    if (episode.edges === 0 && episode.cause === 'wall' && !episode.movingAtOnset) {
      latencies.push(t - episode.onset);
    }
    episode.edges++;
  }

  function frame(s: Snapshot, beatPhase: () => number) {
    if (!started) return;
    t = s.t;
    const above = s.danger > cfg.dangerOnset;
    const moved = s.sector !== prevSector;

    // Threat episodes.
    if (episode && (!above || moved)) episode = null;
    if (!episode && above) {
      if (!prevAbove) threatStart = t;
      const fromClear = moved && !prevAbove;
      episode = { onset: t, cause: moved ? 'self' : 'wall', fromClear, movingAtOnset: s.rotDir !== 0, edges: 0 };
      if (fromClear) clearEntryT = t;
    }
    if (!above) threatStart = -1;

    // Input edges.
    const dir = s.rotDir;
    if (dir !== prevRotDir) {
      if (prevRotDir !== 0 && dir !== 0) {
        lastEdge = 'reversal';
        noteReversal();
      } else if (dir === 0) {
        lastEdge = 'release';
        releaseDir = prevRotDir;
        releaseT = t;
      } else {
        lastEdge = 'onset';
        lastOnsetT = t;
        onsetsAll++;
        if (!above) onsetsClear++;
        const phase = beatPhase();
        if (phase >= 0) {
          sumCos += Math.cos(phase * TAU);
          sumSin += Math.sin(phase * TAU);
          nBeat++;
        }
        lastOnsetWrong =
          above && stepsToClear(s.lanes, s.sector, dir, cfg.dangerOnset) > stepsToClear(s.lanes, s.sector, -dir, cfg.dangerOnset);
        if (releaseDir === -dir && t - releaseT <= cfg.reversalGap) noteReversal();
      }
      noteEdge();
    }

    prevSector = s.sector;
    prevRotDir = dir;
    prevAbove = above;
  }

  function classify(): DeathClass {
    if (recentReversals.filter((r) => t - r <= cfg.jitterWindow).length >= cfg.jitterReversals) return 'jitter';
    if (episode && episode.cause === 'self' && episode.fromClear && t - episode.onset <= cfg.overshootAtDeath) {
      return 'overshoot';
    }
    if (lastEdge === 'onset' && lastOnsetWrong && threatStart >= 0 && lastOnsetT >= threatStart) return 'wrong way';
    if (episode && episode.cause === 'wall' && !episode.movingAtOnset && episode.edges === 0) return 'freeze';
    return 'late';
  }

  function die(): RunSummary {
    const sorted = latencies.slice().sort((a, b) => a - b);
    const summary: RunSummary = {
      time: t,
      reaction: { median: rank(sorted, 0.5), p90: rank(sorted, 0.9), n: sorted.length },
      anticipation: { ratio: onsetsAll ? onsetsClear / onsetsAll : 0, n: onsetsAll },
      beat: {
        r: nBeat ? Math.hypot(sumCos, sumSin) / nBeat : 0,
        phase: nBeat ? Math.atan2(sumSin, sumCos) / TAU : 0,
        n: nBeat,
      },
      loop: { overshoots, reversals },
      death: classify(),
    };
    started = false;
    return summary;
  }

  return {
    start() {
      Object.assign(cfg, next);
      reset();
      started = true;
    },
    frame,
    die,
    configure(c) {
      Object.assign(next, c);
    },
  };
}
