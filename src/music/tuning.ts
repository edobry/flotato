// Every knob the game master can turn while playing, for the music and the player observer. Persisted in
// localStorage; any key can be overridden from the URL as ?tune=key=value,key=value.

import type { ScaleName } from './scale';
import { ARP_CEILINGS, type ArpCeiling } from './evolution';

export interface Tuning {
  /** Which music: v2 is the hypnotic register (pulse, off-beat bass, plateaus); v1 the original engine. */
  register: 'v1' | 'v2';
  /** Master scale on every state-to-music mapping. 0 is a metronome (Super Hexagon). */
  reactivity: number;
  /** Depth of the kick-locked ducking on bass, pad and arp. 0 is flat. */
  pump: number;
  /** Where the arp's density stops: 8ths until 4 layers in then 16ths, 8ths only, or 16ths from its entry. */
  arpCeiling: ArpCeiling;
  /** Bars between layer arrivals in v2. */
  layerBars: number;
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
  /** Added to the audio output latency when placing the visual pulse; trim by ear on Bluetooth. */
  beatOffsetMs: number;
  /** Bars of audible beat before the first wall spawns. 0 is Super Hexagon: walls at once. */
  countInBars: number;
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
  /** Walls pass through the player: every mapping keeps sounding, nothing kills. For tuning by ear. */
  ghost: boolean;
  /** Post each run to the board. Only ever leaves a dev server with `?tune=telemetry=true`. */
  telemetry: boolean;
}

export const DEFAULT_TUNING: Tuning = {
  register: 'v2',
  reactivity: 1,
  pump: 0.5,
  arpCeiling: 'plateau16',
  layerBars: 4,
  bpmFloor: 128,
  bpmCeil: 136,
  bpmRampSeconds: 90,
  drums: true,
  scale: 'minorHexatonic',
  sectorMapping: true,
  tension: 0.25,
  reward: 1,
  foreshadow: false,
  deathMode: 'stop',
  beatPulse: true,
  beatOffsetMs: 0,
  countInBars: 1,
  randomStartOffset: true,
  milestones: true,
  arpPan: false,
  padAutopan: false,
  volume: -6,
  runStats: true,
  dangerOnset: 0,
  ghost: false,
  telemetry: true,
};

export const SCALE_NAMES: ScaleName[] = ['minorHexatonic', 'dorianHexatonic', 'wholeTone', 'majorPentatonic'];
export const REGISTERS: Tuning['register'][] = ['v2', 'v1'];
export { ARP_CEILINGS };
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
  if (key === 'register') {
    return (REGISTERS as string[]).includes(String(raw)) ? (raw as Tuning[K]) : undefined;
  }
  if (key === 'arpCeiling') {
    return (ARP_CEILINGS as string[]).includes(String(raw)) ? (raw as Tuning[K]) : undefined;
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

/** Apply a `?tune=key=value,key=value` string over `base`; unknown keys and unfit values are ignored. */
export function applyTuneParam(base: Tuning, param: string): Tuning {
  const raw: Record<string, unknown> = {};
  for (const kv of param.split(',')) {
    const eq = kv.indexOf('=');
    if (eq > 0) raw[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
  }
  return merge(base, raw);
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
    if (tune) t = applyTuneParam(t, tune);
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
