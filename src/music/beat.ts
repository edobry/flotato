// The Transport's beat phase is scheduling time; what the ear gets is that
// plus the audio output latency (tens of ms wired, 100-250 ms on Bluetooth).
// Shifting the visual by the same amount keeps the pulse on the audible beat.

/**
 * Shift a beat phase (0..1) back by `latencySeconds` at `bpm`, wrapping.
 * A negative phase (Transport not running) passes through unchanged.
 */
export function offsetBeatPhase(phase: number, bpm: number, latencySeconds: number): number {
  if (phase < 0 || !(bpm > 0) || !Number.isFinite(latencySeconds)) return phase;
  const beats = (latencySeconds * bpm) / 60;
  const shifted = (phase - beats) % 1;
  return shifted < 0 ? shifted + 1 : shifted;
}
