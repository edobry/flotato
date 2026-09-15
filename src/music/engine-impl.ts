// The music engine implementation, loaded on demand by engine.ts. Two clocks, one bus: the game writes a snapshot once per
// frame and pushes discrete events; the engine reads the snapshot inside
// Transport callbacks (16th-note ticks, scheduled ahead by Tone) and turns
// patterns into scheduled notes. Nothing here touches React.
//
// Tone is not touched until unlock() runs inside a user gesture: creating the
// AudioContext earlier draws an autoplay warning from the browser.

import * as Tone from 'tone';
import type { Tuning } from './tuning';
import type { MusicEngine, Snapshot, WallKind } from './engine';
import { ROOT_MIDI, SCALES, degreeToHz, midiToHz } from './scale';
import { type Pattern, degradeBy, every, fast, fmap, late, off, rev, sometimesBy, withCtx } from './pattern';
import { arpShapeAt, layersAt } from './evolution';
import { mini } from './mini';
import { createVoices, type Voices } from './voices';
import { offsetBeatPhase } from './beat';

interface Ctx {
  s: Snapshot;
  tuning: Tuning;
  variant: number;
}

const STEPS = 16; // 16th-note steps per cycle; one cycle is one 4/4 bar
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ---- patterns: values are scale degrees, semitone offsets, or drum hits ----
const kickPat = mini<Ctx>('x x x x');
const hatPat = mini<Ctx>('h h h h h h h o');
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

// ---- v2 register: off-beat bass, off-beat hats, a root-sector-octave figure ----
// 's' is the sector's degree, substituted at tick time; the fifth when no sector maps.
const bassPatV2 = mini<Ctx>('~ 0 ~ 0 ~ 0 ~ <0 12>');
const hatPatV2 = mini<Ctx>('~ h ~ h ~ h ~ <h o>');
const arp8 = mini<Ctx>('0 s 6 s 0 s 6 s');
const arp8Passing = mini<Ctx>('0 s 6 s 0 s 5 s');
const arp16 = fast(2, arp8);
const arp16Passing = fast(2, arp8Passing);

/** The arp figure for a bar: density from the layer schedule, shape from the bar count, nothing random. */
function arpPatV2(bar: number, sixteenths: boolean): Pattern<string, Ctx> {
  const shape = arpShapeAt(bar);
  let p = sixteenths ? (shape.passing ? arp16Passing : arp16) : shape.passing ? arp8Passing : arp8;
  if (shape.reverse) p = rev(p);
  if (shape.rotate) p = late(shape.rotate / 4, p);
  return p;
}

export function createEngineImpl(initial: Tuning, audio: AudioContext | null = null): MusicEngine {
  // Adopt the context the facade created inside the user gesture, and drop
  // the one Tone made at import time.
  if (audio) Tone.setContext(audio, true);
  let tuning = initial;
  const state: Snapshot = { t: 0, danger: 0, pressure: 0, sector: 0, lanes: [0, 0, 0, 0, 0, 0], rotDir: 0, camSpin: 0, playing: false };
  const ctx: Ctx = { s: state, tuning, variant: 0 };

  let voices: Voices | null = null;
  let ready = false;
  let muted = false;
  let pendingStart = false;
  let running = false;
  let repeatId = -1;
  let lastBpmTarget = 0;
  // The Transport cycle the run started on, so the v2 schedule counts bars from the run, not from bar 0.
  let startCycle = 0;
  const foreIds: number[] = [];
  // Monophonic voices reject a start time at or before their previous one.
  const lastStart = new Map<string, number>();

  const tr = () => Tone.getTransport();
  const scale = () => SCALES[tuning.scale];
  const sectorOffset = () => (tuning.sectorMapping && tuning.reactivity > 0 ? state.sector : 0);
  const stepTicks = () => tr().PPQ / 4;
  const canStart = (voice: string, time: number) => {
    if (time <= (lastStart.get(voice) ?? -1)) return false;
    lastStart.set(voice, time);
    return true;
  };

  function applyTuning() {
    if (!ready) return;
    Tone.getDestination().volume.value = tuning.volume;
    Tone.getDestination().mute = muted;
    const v = voices;
    if (!v) return;
    v.padPan.depth.value = tuning.padAutopan ? 0.6 : 0;
    if (tuning.register === 'v2') {
      // Rounder arp an octave down, a kick with enough body to read on a phone speaker, hats further back.
      v.arp.set({ oscillator: { type: 'triangle' }, envelope: { attack: 0.004, decay: 0.18, sustain: 0.1, release: 0.14 } });
      v.arp.volume.value = -12;
      v.kick.set({ pitchDecay: 0.04, octaves: 5, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.06 } });
      v.hat.volume.value = -22;
      v.bass.set({ envelope: { attack: 0.004, decay: 0.1, sustain: 0.12, release: 0.05 }, filterEnvelope: { baseFrequency: 90, octaves: 2.5 } });
      v.pad.set({ modulationIndex: 2 });
      v.padLfo.min = -600;
      v.padLfo.max = 600;
    } else {
      v.arp.set({ oscillator: { type: 'square' }, envelope: { attack: 0.004, decay: 0.12, sustain: 0.15, release: 0.12 } });
      v.arp.volume.value = -14;
      v.kick.set({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.05 } });
      v.hat.volume.value = -20;
      v.bass.set({ envelope: { attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.08 }, filterEnvelope: { baseFrequency: 110, octaves: 3 } });
      v.padLfo.min = 0;
      v.padLfo.max = 0;
      v.padFilter.frequency.value = 18000;
    }
  }

  function ensureVoices() {
    if (!voices) voices = createVoices();
    applyTuning();
    if (repeatId < 0) repeatId = tr().scheduleRepeat(tick, '16n');
  }

  function clearFore() {
    for (const id of foreIds) tr().clear(id);
    foreIds.length = 0;
  }

  function tick(time: number) {
    if (tuning.register === 'v2') tickV2(time);
    else tickV1(time);
  }

  function tickV1(time: number) {
    const v = voices;
    if (!v || !running) return;
    const t = tr();
    const step = Math.round(t.getTicksAtTime(time) / stepTicks());
    const cycleStart = step / STEPS;
    const span = { start: cycleStart, end: cycleStart + 1 / STEPS };
    const secPerCycle = (60 / t.bpm.value) * 4;
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
      const when = at(h.start);
      if (canStart('bass', when)) {
        v.bass.triggerAttackRelease(midiToHz(ROOT_MIDI + Number(h.value)), dur(h, 0.7, 0.05), when, 0.9);
      }
    }
    for (const h of padPat(span, ctx)) {
      const d = Number(h.value);
      const notes = [d, d + 2, d + 4].map((x) => degreeToHz(sc, x, 1));
      v.pad.triggerAttackRelease(notes, dur(h, 0.95, 0.2), at(h.start), 0.5);
    }
    if (tuning.drums) {
      for (const h of kickPat(span, ctx)) {
        const when = at(h.start);
        if (canStart('kick', when)) v.kick.triggerAttackRelease(midiToHz(36), 0.12, when, 1);
      }
      for (const h of hatsPat(span, ctx)) {
        const when = at(h.start);
        if (!canStart('hat', when)) continue;
        const open = h.value === 'o';
        v.hat.triggerAttackRelease(open ? 0.12 : 0.03, when, open ? 0.5 : 0.3);
      }
    }

    // Continuous mappings, all scaled by reactivity.
    const cutoff = 300 + 6700 * (1 - 0.9 * tuning.tension * react * state.danger);
    v.arpFilter.frequency.setTargetAtTime(cutoff, time, 0.02);
    v.pad.set({ modulationIndex: 2 + 6 * react * state.pressure });
    v.arpPan.pan.setTargetAtTime(tuning.arpPan ? 0.5 * state.rotDir : 0, time, 0.05);

    stepTempo(time);
  }

  /** Survival time lifts the tempo from floor to ceiling in 0.25 BPM steps. */
  function stepTempo(time: number) {
    const t = tr();
    const ramp = clamp01(state.t / Math.max(1, tuning.bpmRampSeconds));
    const target = tuning.bpmFloor + (tuning.bpmCeil - tuning.bpmFloor) * ramp;
    if (Math.abs(target - lastBpmTarget) > 0.25) {
      lastBpmTarget = target;
      // A step, not a ramp: `rampTo` from a tick callback puts linear-ramp
      // automation on the tick grid, and Tone's getTimeOfTick can take the
      // wrong quadratic root when a tick lands within float noise of such an
      // event, which returns a negative time and kills the Transport. Steps
      // never enter that branch, and 0.25 BPM is inaudible.
      t.bpm.setValueAtTime(target, time);
    }
  }

  /**
   * The v2 register. Layers arrive on plateaus counted in bars from the run's
   * start; the bass and hats sit between the kicks; every beat ducks the bass,
   * pad and arp (the pump) whether or not the drums play; the arp's shape is a
   * schedule, not a dice roll; danger lifts brightness a little instead of
   * choking the arp.
   */
  function tickV2(time: number) {
    const v = voices;
    if (!v || !running) return;
    const t = tr();
    const step = Math.round(t.getTicksAtTime(time) / stepTicks());
    const cycleStart = step / STEPS;
    const span = { start: cycleStart, end: cycleStart + 1 / STEPS };
    const secPerCycle = (60 / t.bpm.value) * 4;
    const at = (start: number) => time + (start - cycleStart) * secPerCycle;
    const dur = (h: { start: number; end: number }, k: number, min: number) =>
      Math.max(min, (h.end - h.start) * secPerCycle * k);
    ctx.tuning = tuning;
    const sc = scale();
    const sector = sectorOffset();
    const react = tuning.reactivity;
    const bar = Math.floor(cycleStart) - startCycle;
    const layers = layersAt(bar, tuning.layerBars, tuning.arpCeiling);

    // The pulse: on every beat, dip and recover in about 120 ms.
    if (step % (STEPS / 4) === 0 && tuning.pump > 0) {
      const depth = 0.6 * clamp01(tuning.pump);
      v.duck.gain.cancelScheduledValues(time);
      v.duck.gain.setValueAtTime(1 - depth, time);
      v.duck.gain.setTargetAtTime(1, time, 0.045);
    }

    for (const h of padPat(span, ctx)) {
      const d = Number(h.value);
      const notes = [d, d + 2, d + 4].map((x) => degreeToHz(sc, x, 1));
      v.pad.triggerAttackRelease(notes, dur(h, 0.95, 0.2), at(h.start), 0.5);
    }
    for (const h of bassPatV2(span, ctx)) {
      const when = at(h.start);
      if (canStart('bass', when)) {
        v.bass.triggerAttackRelease(midiToHz(ROOT_MIDI + Number(h.value)), dur(h, 0.5, 0.05), when, 0.85);
      }
    }
    if (layers.arp) {
      const pat = arpPatV2(bar, layers.sixteenths);
      const vel = layers.sixteenths ? 0.42 : 0.5;
      for (const h of pat(span, ctx)) {
        const deg = h.value === 's' ? sector || 4 : Number(h.value);
        v.arp.triggerAttackRelease(degreeToHz(sc, deg, 1), dur(h, 0.5, 0.03), at(h.start), vel);
      }
    }
    if (tuning.drums) {
      if (layers.kick) {
        for (const h of kickPat(span, ctx)) {
          const when = at(h.start);
          if (canStart('kick', when)) v.kick.triggerAttackRelease(midiToHz(41), 0.14, when, layers.arp ? 0.95 : 0.8);
        }
      }
      if (layers.hats) {
        for (const h of hatPatV2(span, ctx)) {
          const when = at(h.start);
          if (!canStart('hat', when)) continue;
          const open = h.value === 'o';
          v.hat.triggerAttackRelease(open ? 0.1 : 0.03, when, open ? 0.4 : 0.25);
        }
      }
    }

    // Continuous mappings: danger lifts, pressure brightens the pad a little; both scaled by reactivity.
    const lift = tuning.tension * react * state.danger;
    v.arpFilter.frequency.setTargetAtTime(3200 + 1800 * lift, time, 0.03);
    v.padFilter.frequency.setTargetAtTime(1800 + 900 * react * state.pressure, time, 0.1);
    v.arpPan.pan.setTargetAtTime(tuning.arpPan ? 0.5 * state.rotDir : 0, time, 0.05);

    stepTempo(time);
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
        /* resume was refused; ready stays false and the next gesture retries */
      });
  }

  function start() {
    if (!ready) {
      pendingStart = true;
      return;
    }
    ensureVoices();
    const v = voices as Voices;
    const t = tr();
    const now = Tone.now();
    clearFore();
    v.pad.releaseAll(now);
    v.master.frequency.cancelScheduledValues(now);
    v.master.frequency.setValueAtTime(18000, now);
    t.stop(now);
    t.bpm.cancelScheduledValues(now);
    t.bpm.setValueAtTime(tuning.bpmFloor, now);
    lastBpmTarget = tuning.bpmFloor;
    ctx.variant = 0;
    const bar = tuning.randomStartOffset ? Math.floor(Math.random() * 16) : 0;
    t.position = `${bar}:0:0`;
    startCycle = bar;
    v.duck.gain.cancelScheduledValues(now);
    v.duck.gain.setValueAtTime(1, now);
    running = true;
    t.start(now + 0.03);
  }

  function pause() {
    if (!ready || !running) return;
    const t = tr();
    if (t.state === 'started') t.pause();
  }

  function resume() {
    if (!ready || !running) return;
    const t = tr();
    if (t.state !== 'paused') return;
    // The game freezes walls through a count-in on resume, so figures scheduled
    // before the pause would now land early.
    clearFore();
    // iOS suspends the context in the background; resuming after the page's first
    // gesture needs no new one.
    Tone.start().catch(() => {
      /* the next gesture retries through unlock() */
    });
    t.start();
  }

  function die() {
    const v = voices;
    if (!v || !running) return;
    running = false;
    const t = tr();
    const now = Tone.now();
    clearFore();
    v.master.frequency.cancelScheduledValues(now);
    v.master.frequency.setValueAtTime(v.master.frequency.value, now);
    v.master.frequency.exponentialRampToValueAtTime(tuning.register === 'v2' ? 220 : 160, now + (tuning.register === 'v2' ? 0.9 : 0.6));
    if (canStart('death', now)) {
      v.death.triggerAttack(midiToHz(ROOT_MIDI + 12), now, 0.8);
      v.death.frequency.exponentialRampToValueAtTime(25, now + 0.7);
      v.death.triggerRelease(now + 0.7);
    }
    t.bpm.rampTo(Math.max(40, t.bpm.value * 0.5), 0.6);
    t.stop(now + 0.75);
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
    if (tuning.register !== 'v2') ctx.variant = n;
    const v = voices;
    if (!v || !running || !tuning.milestones) return;
    const t = tr();
    const when = t.nextSubdivision('16n');
    const sc = scale();
    v.sting.triggerAttackRelease(degreeToHz(sc, 0, 3), 0.15, when, 0.3);
    v.sting.triggerAttackRelease(degreeToHz(sc, 3, 3), 0.25, when + 0.12, 0.35);
  }

  function thread() {
    const v = voices;
    if (!v || !running) return;
    const level = tuning.reward * tuning.reactivity;
    if (level <= 0) return;
    const when = tr().nextSubdivision('16n');
    if (!canStart('pluck', when)) return;
    v.pluck.triggerAttackRelease(degreeToHz(scale(), sectorOffset() + 4, 3), 0.12, when, 0.9 * level);
  }

  function spawn(kind: WallKind, arrivalT: number) {
    const v = voices;
    const t = ready ? tr() : null;
    if (!v || !t || !running || !tuning.foreshadow || t.state !== 'started') return;
    const secondsUntil = arrivalT - state.t;
    if (secondsUntil < 0.25) return;
    const now = Tone.now();
    const nowStep = t.getTicksAtTime(now) / stepTicks();
    const arrivalStep = Math.round(t.getTicksAtTime(now + secondsUntil) / stepTicks());
    const figure = kind === 'ring' ? [0, 0, 0] : kind === 'chunk' ? [0, 3, 3] : [0, 1, 2, 3];
    const sc = scale();
    const level = 0.4 * tuning.reactivity;
    figure.forEach((deg, i) => {
      const stepAt = arrivalStep - (figure.length - 1 - i);
      if (stepAt <= nowStep + 1) return;
      const id = t.scheduleOnce((time) => {
        if (canStart('fore', time)) v.fore.triggerAttackRelease(degreeToHz(sc, deg, 3), 0.08, time, level);
      }, `${stepAt * stepTicks()}i`);
      foreIds.push(id);
    });
  }

  return {
    unlock,
    start,
    pause,
    resume,
    die,
    best,
    thread,
    spawn,
    milestone,
    setSnapshot(s) {
      Object.assign(state, s);
    },
    beatPhase() {
      if (!ready || !running) return -1;
      const t = tr();
      if (t.state !== 'started') return -1;
      // Transport time is scheduling time; the ear gets it after the output latency.
      const raw = (t.ticks % t.PPQ) / t.PPQ;
      const rc = Tone.getContext().rawContext as Partial<AudioContext>;
      const latency = (rc.outputLatency ?? 0) + (rc.baseLatency ?? 0) + tuning.beatOffsetMs / 1000;
      return offsetBeatPhase(raw, t.bpm.value, latency);
    },
    setMuted(m) {
      muted = m;
      if (ready) Tone.getDestination().mute = m;
    },
    setTuning(t) {
      tuning = t;
      ctx.tuning = t;
      applyTuning();
    },
    dispose() {
      running = false;
      if (!ready) return;
      const t = tr();
      t.stop();
      if (repeatId >= 0) t.clear(repeatId);
      repeatId = -1;
      clearFore();
      voices?.dispose();
      voices = null;
    },
  };
}
