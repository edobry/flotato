// The instruments. Austere: one bass, minimal drums, one arp, one pad, and a
// few one-shot voices. Everything except the stinger routes through one master
// filter so death can sweep the whole mix.

import * as Tone from 'tone';

export interface Voices {
  master: Tone.Filter;
  bass: Tone.MonoSynth;
  kick: Tone.MembraneSynth;
  hat: Tone.NoiseSynth;
  arp: Tone.PolySynth;
  arpFilter: Tone.Filter;
  arpPan: Tone.Panner;
  pad: Tone.PolySynth<Tone.FMSynth>;
  padPan: Tone.AutoPanner;
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

  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { type: 'lowpass', Q: 2, rolloff: -24 },
    filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0.25, release: 0.1, baseFrequency: 110, octaves: 3 },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.08 },
    volume: -8,
  }).connect(master);

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
    maxPolyphony: 8,
    volume: -14,
    options: {
      oscillator: { type: 'square' },
      envelope: { attack: 0.004, decay: 0.12, sustain: 0.15, release: 0.12 },
    },
  });
  arp.chain(arpFilter, arpPan, verb, master);

  const padPan = new Tone.AutoPanner({ frequency: 0.12, depth: 0 }).connect(master).start();
  const pad = new Tone.PolySynth({
    voice: Tone.FMSynth,
    maxPolyphony: 6,
    volume: -20,
    options: {
      harmonicity: 2,
      modulationIndex: 3,
      envelope: { attack: 0.4, decay: 0.3, sustain: 0.7, release: 1.2 },
      modulationEnvelope: { attack: 0.5, decay: 0.2, sustain: 0.6, release: 1 },
    },
  }).connect(padPan);

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

  const nodes = [limiter, comp, master, bass, kick, hatHp, hat, arpPan, verb, arpFilter, arp, padPan, pad, pluck, sting, fore, death];

  return {
    master,
    bass,
    kick,
    hat,
    arp,
    arpFilter,
    arpPan,
    pad,
    padPan,
    pluck,
    sting,
    fore,
    death,
    dispose() {
      for (const n of nodes) n.dispose();
    },
  };
}
