// Every knob the game master can turn while playing, for the music and the player observer. Persisted in
// localStorage; any key can be overridden from the URL as ?tune=key=value,key=value.

import type { ScaleName } from './scale';

export interface Tuning {
  /** Master scale on every state-to-music mapping. 0 is a metronome (Super Hexagon). */
  reactivity: number;
  bpmFloor: number;
  bpmCeil: number;
  /** Seconds of survival over which BPM ramps from floor to ceiling. */
  bpmRampSeconds: number;
  drums: boolean;
  scale: ScaleName;
  /** The arp emphasizes the scale degree of the sector the player occupies. */
  sectorMapping: boolean;
  /** Depth of the danger-to-arp-filter mapping. */
  tension: number;
  /** Level of the accent that fires when a gap is threaded. 0 is off. */
  reward: number;
  /** Rhythmic figures that land when a spawned wall reaches the player. */
  foreshadow: boolean;
  deathMode: 'stop' | 'drone';
  /** Lock the visual pulse to the Transport beat. */
  beatPulse: boolean;
  /** Start each run at a random bar so retries never replay an intro. */
  randomStartOffset: boolean;
  /** A short punctuation and a pattern transform every 10 seconds survived. */
  milestones: boolean;
  /** Proprioceptive echoes, off by default: pan the arp with rotation input. */
  arpPan: boolean;
  /** Autopan the pad with camera spin. */
  padAutopan: boolean;
  /** Master volume in dB. */
  volume: number;
  /** Show the run's loop metrics on the game-over screen. */
  runStats: boolean;
  /** Lane danger crossing above this is a threat onset for the player observer. 0 is the edge of the danger range. */
  dangerOnset: number;
}

export const DEFAULT_TUNING: Tuning = {
  reactivity: 1,
  bpmFloor: 160,
  bpmCeil: 172,
  bpmRampSeconds: 40,
  drums: true,
  scale: 'wholeTone',
  sectorMapping: true,
  tension: 0.5,
  reward: 1,
  foreshadow: false,
  deathMode: 'stop',
  beatPulse: true,
  randomStartOffset: true,
  milestones: true,
  arpPan: false,
  padAutopan: false,
  volume: -6,
  runStats: true,
  dangerOnset: 0,
};

export const SCALE_NAMES: ScaleName[] = ['wholeTone', 'minorHexatonic', 'majorPentatonic'];
export const DEATH_MODES: Tuning['deathMode'][] = ['stop', 'drone'];

const STORAGE_KEY = 'flotato.tuning';

/** Coerce one raw value to the type of its default; undefined when it does not fit. */
function coerce<K extends keyof Tuning>(key: K, raw: unknown): Tuning[K] | undefined {
  const def = DEFAULT_TUNING[key];
  if (typeof def === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? (n as Tuning[K]) : undefined;
  }
  if (typeof def === 'boolean') {
    if (typeof raw === 'boolean') return raw as Tuning[K];
    if (raw === 'true' || raw === '1') return true as Tuning[K];
    if (raw === 'false' || raw === '0') return false as Tuning[K];
    return undefined;
  }
  if (key === 'scale') {
    return (SCALE_NAMES as string[]).includes(String(raw)) ? (raw as Tuning[K]) : undefined;
  }
  if (key === 'deathMode') {
    return (DEATH_MODES as string[]).includes(String(raw)) ? (raw as Tuning[K]) : undefined;
  }
  return undefined;
}

function merge(base: Tuning, raw: Record<string, unknown>): Tuning {
  const out: Tuning = { ...base };
  for (const key of Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]) {
    if (!(key in raw)) continue;
    const v = coerce(key, raw[key]);
    if (v !== undefined) (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}

export function loadTuning(): Tuning {
  let t: Tuning = { ...DEFAULT_TUNING };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') t = merge(t, parsed as Record<string, unknown>);
    }
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  try {
    const tune = new URLSearchParams(location.search).get('tune');
    if (tune) {
      const raw: Record<string, unknown> = {};
      for (const kv of tune.split(',')) {
        const eq = kv.indexOf('=');
        if (eq > 0) raw[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
      }
      t = merge(t, raw);
    }
  } catch {
    /* no location in this environment */
  }
  return t;
}

export function saveTuning(t: Tuning): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* storage unavailable */
  }
}

export function resetTuning(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
