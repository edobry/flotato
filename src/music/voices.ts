// The instruments. Austere: one bass, minimal drums, one arp, one pad, and a
// few one-shot voices. Everything except the stinger routes through one master
// filter so death can sweep the whole mix. Bass, arp and pad also pass through
// `duck`, the gain the engine dips on every beat for the v2 register's pulse;
// the drums bypass it so the kick itself never ducks. In the v1 register the
// gain stays at unity and the pad filter wide open, so the v1 signal path is
// the previous one to within a transparent node.

import * as Tone from 'tone';

export interface Voices {
  master: Tone.Filter;
  /** Kick-locked ducking for everything but the drums. */
  duck: Tone.Gain;
  bass: Tone.MonoSynth;
  kick: Tone.MembraneSynth;
  hat: Tone.NoiseSynth;
  arp: Tone.PolySynth;
  arpFilter: Tone.Filter;
  arpPan: Tone.Panner;
  pad: Tone.PolySynth<Tone.FMSynth>;
  padPan: Tone.AutoPanner;
  /** The pad's low-pass, breathed by `padLfo`; the engine adds a little brightness with pressure. */
  padFilter: Tone.Filter;
  padLfo: Tone.LFO;
  pluck: Tone.Synth;
  sting: Tone.PolySynth;
  fore: Tone.Synth;
  death: Tone.MonoSynth;
  dispose(): void;
}

export function createVoices(): Voices {
  const limiter = new Tone.Limiter(-1).connect(Tone.getDestination());
  const comp = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.15 }).connect(
    limiter,
  );
  const master = new Tone.Filter({ type: 'lowpass', frequency: 18000, rolloff: -24, Q: 0.7 }).connect(
    comp,
  );
  const duck = new Tone.Gain(1).connect(master);

  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { type: 'lowpass', Q: 2, rolloff: -24 },
    filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0.25, release: 0.1, baseFrequency: 110, octaves: 3 },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.08 },
    volume: -8,
  }).connect(duck);

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.05 },
    volume: -4,
  }).connect(master);

  const hatHp = new Tone.Filter({ type: 'highpass', frequency: 7000 }).connect(master);
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
    volume: -20,
  }).connect(hatHp);

  const arpPan = new Tone.Panner(0);
  const verb = new Tone.Freeverb({ roomSize: 0.6, dampening: 3000, wet: 0.15 });
  const arpFilter = new Tone.Filter({ type: 'lowpass', frequency: 7000, rolloff: -24, Q: 1.5 });
  const arp = new Tone.PolySynth({
    voice: Tone.Synth,
    maxPolyphony: 16,
    volume: -14,
    options: {
      oscillator: { type: 'square' },
      envelope: { attack: 0.004, decay: 0.12, sustain: 0.15, release: 0.12 },
    },
  });
  arp.chain(arpFilter, arpPan, verb, duck);

  const padPan = new Tone.AutoPanner({ frequency: 0.12, depth: 0 }).connect(duck).start();
  // Breathing: the LFO adds ±600 Hz around whatever base the engine sets, over about twenty seconds.
  const padFilter = new Tone.Filter({ type: 'lowpass', frequency: 1800, rolloff: -12, Q: 0.5 }).connect(padPan);
  const padLfo = new Tone.LFO({ frequency: 0.05, min: -600, max: 600 }).start();
  padLfo.connect(padFilter.frequency);
  const pad = new Tone.PolySynth({
    voice: Tone.FMSynth,
    maxPolyphony: 12,
    volume: -20,
    options: {
      harmonicity: 2,
      modulationIndex: 3,
      envelope: { attack: 0.4, decay: 0.3, sustain: 0.7, release: 1.2 },
      modulationEnvelope: { attack: 0.5, decay: 0.2, sustain: 0.6, release: 1 },
    },
  }).connect(padFilter);

  const pluck = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.003, decay: 0.16, sustain: 0, release: 0.12 },
    volume: -10,
  }).connect(master);

  // The stinger bypasses the master filter so it cuts through the death sweep.
  const sting = new Tone.PolySynth({
    voice: Tone.Synth,
    maxPolyphony: 6,
    volume: -12,
    options: {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.6 },
    },
  }).connect(comp);

  const fore = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.1 },
    volume: -16,
  }).connect(master);

  const death = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { type: 'lowpass', Q: 1, rolloff: -12 },
    filterEnvelope: { attack: 0.01, decay: 0.4, sustain: 0.3, release: 0.3, baseFrequency: 200, octaves: 2 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.3 },
    volume: -8,
  }).connect(comp);

  const nodes = [limiter, comp, master, duck, bass, kick, hatHp, hat, arpPan, verb, arpFilter, arp, padPan, padFilter, padLfo, pad, pluck, sting, fore, death];

  return {
    master,
    duck,
    bass,
    kick,
    hat,
    arp,
    arpFilter,
    arpPan,
    pad,
    padPan,
    padFilter,
    padLfo,
    pluck,
    sting,
    fore,
    death,
    dispose() {
      for (const n of nodes) n.dispose();
    },
  };
}
