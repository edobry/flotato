// The music engine. Two clocks, one bus: the game writes a snapshot once per
// frame and pushes discrete events; the engine reads the snapshot inside
// Transport callbacks (16th-note ticks, scheduled ahead by Tone) and turns
// patterns into scheduled notes. Nothing here touches React.

import * as Tone from 'tone';
import type { Tuning } from './tuning';
import { ROOT_MIDI, SCALES, degreeToHz, midiToHz } from './scale';
import { type Pattern, degradeBy, every, fast, fmap, off, rev, sometimesBy, withCtx } from './pattern';
import { mini } from './mini';
import { createVoices, type Voices } from './voices';

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
  /** Call from inside a user gesture handler; resumes the AudioContext. */
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

interface Ctx {
  s: Snapshot;
  tuning: Tuning;
  variant: number;
}

const STEPS = 16; // 16th-note steps per cycle; one cycle is one 4/4 bar
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ---- patterns: values are scale degrees, semitone offsets, or drum hits ----
const kickPat = mini<Ctx>('x x x x');
const hatPat = mini<Ctx>('h*8, ~ ~ ~ [~ o]');
const bassPat = mini<Ctx>('0 0 0 0 0 0 <7 10 7 5> 0');
const arpSeed = mini<Ctx>('0 [2 4] 5 [4 2] 0 [1 3] 5 [3 1]');
const padPat = mini<Ctx>('<0 2 1 5>');

const shiftDeg = (n: number) => (p: Pattern<string, Ctx>) => fmap(p, (d) => String(Number(d) + n));

/** Survival time transforms the arp rather than adding voices: each milestone flips a transform on. */
const arpPat: Pattern<string, Ctx> = withCtx((ctx) => {
  let p = arpSeed;
  const level = Math.min(ctx.variant, 3);
  if (level >= 1) p = every(4, rev, p);
  if (level >= 2) p = sometimesBy(0.3, (q) => off(1 / 16, shiftDeg(2), q), p, 3);
  if (level >= 3) p = every(2, (q) => fast(2, q), p);
  if (ctx.variant >= 4) p = every(8, shiftDeg(1), p);
  const drop = 0.3 - 0.25 * clamp01(ctx.s.t / 45);
  return degradeBy(drop, p, 11);
});

const hatsPat: Pattern<string, Ctx> = withCtx((ctx) =>
  ctx.variant >= 3 ? every(4, (q) => fast(2, q), hatPat) : hatPat,
);

export function createMusicEngine(initial: Tuning): MusicEngine {
  let tuning = initial;
  const state: Snapshot = { t: 0, danger: 0, pressure: 0, sector: 0, rotDir: 0, camSpin: 0, playing: false };
  const ctx: Ctx = { s: state, tuning, variant: 0 };
  const tr = Tone.getTransport();

  let voices: Voices | null = null;
  let ready = false;
  let pendingStart = false;
  let running = false;
  let repeatId = -1;
  let lastBpmTarget = 0;
  let lastThreadAt = -1;
  const foreIds: number[] = [];

  const scale = () => SCALES[tuning.scale];
  const sectorOffset = () => (tuning.sectorMapping && tuning.reactivity > 0 ? state.sector : 0);
  const stepTicks = () => tr.PPQ / 4;

  function applyTuning() {
    Tone.getDestination().volume.value = tuning.volume;
    if (voices) voices.padPan.depth.value = tuning.padAutopan ? 0.6 : 0;
  }

  function ensureVoices() {
    if (!voices) {
      voices = createVoices();
      applyTuning();
    }
    if (repeatId < 0) repeatId = tr.scheduleRepeat(tick, '16n');
  }

  function clearFore() {
    for (const id of foreIds) tr.clear(id);
    foreIds.length = 0;
  }

  function tick(time: number) {
    const v = voices;
    if (!v || !running) return;
    const step = Math.round(tr.getTicksAtTime(time) / stepTicks());
    const cycleStart = step / STEPS;
    const span = { start: cycleStart, end: cycleStart + 1 / STEPS };
    const secPerCycle = (60 / tr.bpm.value) * 4;
    const at = (start: number) => time + (start - cycleStart) * secPerCycle;
    const dur = (h: { start: number; end: number }, k: number, min: number) =>
      Math.max(min, (h.end - h.start) * secPerCycle * k);
    ctx.tuning = tuning;
    const sc = scale();
    const offset = sectorOffset();
    const react = tuning.reactivity;

    for (const h of arpPat(span, ctx)) {
      v.arp.triggerAttackRelease(degreeToHz(sc, Number(h.value) + offset, 2), dur(h, 0.8, 0.03), at(h.start), 0.55);
    }
    for (const h of bassPat(span, ctx)) {
      v.bass.triggerAttackRelease(midiToHz(ROOT_MIDI + Number(h.value)), dur(h, 0.7, 0.05), at(h.start), 0.9);
    }
    for (const h of padPat(span, ctx)) {
      const d = Number(h.value);
      const notes = [d, d + 2, d + 4].map((x) => degreeToHz(sc, x, 1));
      v.pad.triggerAttackRelease(notes, dur(h, 0.95, 0.2), at(h.start), 0.5);
    }
    if (tuning.drums) {
      for (const h of kickPat(span, ctx)) v.kick.triggerAttackRelease(midiToHz(36), 0.12, at(h.start), 1);
      for (const h of hatsPat(span, ctx)) {
        const open = h.value === 'o';
        v.hat.triggerAttackRelease(open ? 0.12 : 0.03, at(h.start), open ? 0.5 : 0.3);
      }
    }

    // Continuous mappings, all scaled by reactivity.
    const cutoff = 300 + 6700 * (1 - 0.9 * tuning.tension * react * state.danger);
    v.arpFilter.frequency.setTargetAtTime(cutoff, time, 0.02);
    v.pad.set({ modulationIndex: 2 + 6 * react * state.pressure });
    v.arpPan.pan.setTargetAtTime(tuning.arpPan ? 0.5 * state.rotDir : 0, time, 0.05);

    const ramp = clamp01(state.t / Math.max(1, tuning.bpmRampSeconds));
    const target = tuning.bpmFloor + (tuning.bpmCeil - tuning.bpmFloor) * ramp;
    if (Math.abs(target - lastBpmTarget) > 0.25) {
      lastBpmTarget = target;
      tr.bpm.rampTo(target, 0.5);
    }
  }

  function unlock() {
    if (ready) return;
    Tone.start()
      .then(() => {
        ready = true;
        ensureVoices();
        if (pendingStart) {
          pendingStart = false;
          start();
        }
      })
      .catch(() => {
        /* the next gesture will try again */
      });
  }

  function start() {
    if (!ready) {
      pendingStart = true;
      return;
    }
    ensureVoices();
    const v = voices as Voices;
    const now = Tone.now();
    clearFore();
    v.pad.releaseAll(now);
    v.master.frequency.cancelScheduledValues(now);
    v.master.frequency.setValueAtTime(18000, now);
    tr.stop(now);
    tr.bpm.cancelScheduledValues(now);
    tr.bpm.setValueAtTime(tuning.bpmFloor, now);
    lastBpmTarget = tuning.bpmFloor;
    ctx.variant = 0;
    const bar = tuning.randomStartOffset ? Math.floor(Math.random() * 16) : 0;
    tr.position = `${bar}:0:0`;
    running = true;
    tr.start(now + 0.03);
  }

  function die() {
    const v = voices;
    if (!v || !running) return;
    running = false;
    const now = Tone.now();
    clearFore();
    v.master.frequency.cancelScheduledValues(now);
    v.master.frequency.setValueAtTime(v.master.frequency.value, now);
    v.master.frequency.exponentialRampToValueAtTime(160, now + 0.6);
    v.death.triggerAttack(midiToHz(ROOT_MIDI + 12), now, 0.8);
    v.death.frequency.exponentialRampToValueAtTime(25, now + 0.7);
    v.death.triggerRelease(now + 0.7);
    tr.bpm.rampTo(Math.max(40, tr.bpm.value * 0.5), 0.6);
    tr.stop(now + 0.75);
    if (tuning.deathMode === 'drone') {
      v.pad.releaseAll(now);
      v.pad.triggerAttack([midiToHz(ROOT_MIDI - 12), midiToHz(ROOT_MIDI - 5)], now + 0.3, 0.35);
    } else {
      v.pad.releaseAll(now + 0.4);
      v.arp.releaseAll(now + 0.4);
    }
  }

  function best() {
    const v = voices;
    if (!v) return;
    const now = Tone.now();
    const sc = scale();
    const notes = [0, 2, 4, 6].map((d) => degreeToHz(sc, d, 3));
    notes.forEach((hz, i) => v.sting.triggerAttackRelease(hz, 0.35, now + i * 0.07, 0.7));
    v.sting.triggerAttackRelease([notes[0], notes[2]], 0.9, now + 0.3, 0.8);
  }

  function milestone(n: number) {
    ctx.variant = n;
    const v = voices;
    if (!v || !running || !tuning.milestones) return;
    const t = tr.state === 'started' ? tr.nextSubdivision('16n') : Tone.now();
    const sc = scale();
    v.sting.triggerAttackRelease(degreeToHz(sc, 0, 3), 0.15, t, 0.3);
    v.sting.triggerAttackRelease(degreeToHz(sc, 3, 3), 0.25, t + 0.12, 0.35);
  }

  function thread() {
    const v = voices;
    if (!v || !running) return;
    const level = tuning.reward * tuning.reactivity;
    if (level <= 0) return;
    const t = tr.nextSubdivision('16n');
    if (t === lastThreadAt) return;
    lastThreadAt = t;
    v.pluck.triggerAttackRelease(degreeToHz(scale(), sectorOffset() + 4, 3), 0.12, t, 0.9 * level);
  }

  function spawn(kind: WallKind, arrivalT: number) {
    const v = voices;
    if (!v || !running || !tuning.foreshadow || tr.state !== 'started') return;
    const secondsUntil = arrivalT - state.t;
    if (secondsUntil < 0.25) return;
    const now = Tone.now();
    const nowStep = tr.getTicksAtTime(now) / stepTicks();
    const arrivalStep = Math.round(tr.getTicksAtTime(now + secondsUntil) / stepTicks());
    const figure = kind === 'ring' ? [0, 0, 0] : kind === 'chunk' ? [0, 3, 3] : [0, 1, 2, 3];
    const sc = scale();
    const level = 0.4 * tuning.reactivity;
    figure.forEach((deg, i) => {
      const stepAt = arrivalStep - (figure.length - 1 - i);
      if (stepAt <= nowStep + 1) return;
      const id = tr.scheduleOnce(
        (time) => v.fore.triggerAttackRelease(degreeToHz(sc, deg, 3), 0.08, time, level),
        `${stepAt * stepTicks()}i`,
      );
      foreIds.push(id);
    });
  }

  return {
    unlock,
    start,
    die,
    best,
    thread,
    spawn,
    milestone,
    setSnapshot(s) {
      Object.assign(state, s);
    },
    beatPhase() {
      if (!running || tr.state !== 'started') return -1;
      return (tr.ticks % tr.PPQ) / tr.PPQ;
    },
    setMuted(m) {
      Tone.getDestination().mute = m;
    },
    setTuning(t) {
      tuning = t;
      ctx.tuning = t;
      applyTuning();
    },
    dispose() {
      running = false;
      tr.stop();
      if (repeatId >= 0) tr.clear(repeatId);
      repeatId = -1;
      clearFore();
      voices?.dispose();
      voices = null;
    },
  };
}
