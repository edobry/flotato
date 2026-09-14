// The music engine facade. Tone.js evaluates deprecated top-level exports at
// import time, which creates the AudioContext and draws an autoplay warning
// if it happens before a user gesture. So the implementation (and Tone with
// it) is loaded dynamically from inside unlock(), which the game calls from
// its start gesture. Until it lands, calls are queued or dropped harmlessly.
//
// Autoplay policy is satisfied synchronously: the first unlock() creates and
// resumes a native AudioContext inside the gesture's own call stack, and the
// implementation adopts that context when it loads. Every later gesture is
// forwarded to the implementation, so a rejected resume can always be retried.

import type { Tuning } from './tuning';

export interface Snapshot {
  /** Survival time in seconds. */
  t: number;
  /** 0..1: nearest incoming wall in the player's lane, over DANGER_RANGE px. */
  danger: number;
  /** 0..1: nearest incoming wall in any lane. */
  pressure: number;
  /** The sector the player occupies, 0..5. */
  sector: number;
  rotDir: -1 | 0 | 1;
  camSpin: number;
  playing: boolean;
}

export type WallKind = 'ring' | 'chunk' | 'spiral';

export interface MusicEngine {
  /** Call from inside a user gesture handler; loads the engine and resumes the AudioContext. */
  unlock(): void;
  start(): void;
  die(): void;
  best(): void;
  /** A gap was threaded or a wall dodged: the reward accent. */
  thread(): void;
  /** A wall pattern spawned; arrivalT is the survival time at which it reaches the player. */
  spawn(kind: WallKind, arrivalT: number): void;
  /** Every 10 seconds survived; n counts from 1. */
  milestone(n: number): void;
  setSnapshot(s: Snapshot): void;
  /** 0..1 within the current beat while running, else -1. */
  beatPhase(): number;
  setMuted(m: boolean): void;
  setTuning(t: Tuning): void;
  dispose(): void;
}

function createNativeContext(): AudioContext | null {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

export function createMusicEngine(initial: Tuning): MusicEngine {
  let impl: MusicEngine | null = null;
  let audio: AudioContext | null = null;
  let loading = false;
  let disposed = false;
  let pendingUnlock = false;
  let pendingStart = false;
  let tuning = initial;
  let muted = false;
  const snap: Snapshot = { t: 0, danger: 0, pressure: 0, sector: 0, rotDir: 0, camSpin: 0, playing: false };

  function unlock() {
    if (disposed) return;
    if (impl) {
      impl.unlock();
      return;
    }
    // Inside the gesture: create and resume the context now, so the
    // activation is consumed synchronously rather than after an async import.
    if (!audio) audio = createNativeContext();
    audio?.resume().catch(() => {
      /* the next gesture retries through impl.unlock() */
    });
    pendingUnlock = true;
    if (loading) return;
    loading = true;
    import('./engine-impl')
      .then(({ createEngineImpl }) => {
        const e = createEngineImpl(tuning, audio);
        if (disposed) {
          e.dispose();
          return;
        }
        e.setMuted(muted);
        e.setSnapshot(snap);
        impl = e;
        if (pendingUnlock) {
          pendingUnlock = false;
          e.unlock();
        }
        if (pendingStart) {
          pendingStart = false;
          e.start();
        }
      })
      .catch(() => {
        loading = false; // the next gesture tries again
      });
  }

  return {
    unlock,
    start() {
      if (impl) impl.start();
      else pendingStart = true;
    },
    die() {
      pendingStart = false;
      impl?.die();
    },
    best() {
      impl?.best();
    },
    thread() {
      impl?.thread();
    },
    spawn(kind, arrivalT) {
      impl?.spawn(kind, arrivalT);
    },
    milestone(n) {
      impl?.milestone(n);
    },
    setSnapshot(s) {
      Object.assign(snap, s);
      impl?.setSnapshot(s);
    },
    beatPhase() {
      return impl ? impl.beatPhase() : -1;
    },
    setMuted(m) {
      muted = m;
      impl?.setMuted(m);
    },
    setTuning(t) {
      tuning = t;
      impl?.setTuning(t);
    },
    dispose() {
      disposed = true;
      impl?.dispose();
      impl = null;
      audio?.close().catch(() => {
        /* already closed */
      });
      audio = null;
    },
  };
}
