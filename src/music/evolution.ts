// How the v2 register grows over a run, as pure functions of bars since the
// Transport started. Layers arrive on plateaus (hypnotic techno introduces
// elements one at a time and never drops), and the arp changes shape on a
// fixed schedule instead of by chance. Nothing here consults the clock or
// the player; the engine passes the bar.

export type ArpCeiling = 'plateau16' | 'eighths' | 'sixteenths';
export const ARP_CEILINGS: ArpCeiling[] = ['plateau16', 'eighths', 'sixteenths'];

export interface Layers {
  /** Pad and bass are always on; the pulse arrives softly from the first bar. */
  kick: boolean;
  arp: boolean;
  hats: boolean;
  /** The arp at 16th density rather than 8ths. */
  sixteenths: boolean;
}

/**
 * Which layers sound at `bar`, with `layerBars` bars between arrivals:
 * arp at 1L, hats at 2L, the arp's move to 16ths at 4L (plateau16), never
 * (eighths), or with the arp itself (sixteenths).
 */
export function layersAt(bar: number, layerBars: number, ceiling: ArpCeiling): Layers {
  const L = Math.max(1, layerBars);
  const b = Math.floor(bar);
  const arp = b >= L;
  const sixteenths = ceiling === 'eighths' ? false : ceiling === 'sixteenths' ? arp : b >= 4 * L;
  return { kick: b >= 0, arp, hats: b >= 2 * L, sixteenths };
}

export interface ArpShape {
  /** Beats the figure is rotated by, 0..3; changes every 8 bars. */
  rotate: number;
  /** The octave in the second half is replaced by a passing tone; alternates every 16 bars. */
  passing: boolean;
  /** The figure runs backwards; alternates every 32 bars. */
  reverse: boolean;
}

export function arpShapeAt(bar: number): ArpShape {
  const b = Math.max(0, Math.floor(bar));
  return {
    rotate: Math.floor(b / 8) % 4,
    passing: Math.floor(b / 16) % 2 === 1,
    reverse: Math.floor(b / 32) % 2 === 1,
  };
}

/** Bars per second at a tempo, for turning seconds into bars in tests and docs. */
export function barsPerSecond(bpm: number): number {
  return bpm / 60 / 4;
}
