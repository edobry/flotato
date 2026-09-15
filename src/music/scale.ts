// Six-note scales so the hexagon's six sectors map onto six degrees.

export type ScaleName = 'wholeTone' | 'minorHexatonic' | 'dorianHexatonic' | 'majorPentatonic';

export const SCALES: Record<ScaleName, readonly number[]> = {
  // No tonic pull: every sector is equally consonant. The default.
  wholeTone: [0, 2, 4, 6, 8, 10],
  // Root and fifth pull; darker, more grounded. The v2 default.
  minorHexatonic: [0, 2, 3, 5, 7, 10],
  // Minor with a bright sixth: the same pull, less shadow.
  dorianHexatonic: [0, 2, 3, 5, 7, 9],
  // Reserved for potato mode: five notes plus the octave to stay six wide.
  majorPentatonic: [0, 2, 4, 7, 9, 12],
};

/** A2. Bass root; the arp and pad sit octaves above. */
export const ROOT_MIDI = 45;

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function degreeToMidi(scale: readonly number[], degree: number, octave = 0): number {
  const n = scale.length;
  const d = ((degree % n) + n) % n;
  const wrap = Math.floor(degree / n);
  return ROOT_MIDI + scale[d] + 12 * (octave + wrap);
}

export function degreeToHz(scale: readonly number[], degree: number, octave = 0): number {
  return midiToHz(degreeToMidi(scale, degree, octave));
}
