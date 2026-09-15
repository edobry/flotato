// Runs leave the phone: one POST per run to the board Worker, fire-and-forget.
// The game never waits on the network; a failed post is a console warning.

import type { RunSummary } from './player/observer';
import type { Tuning } from './music/tuning';
import { BOARD_URL, SITE_ORIGIN } from './config';

export const TAG_LENGTH = 3;
const DEVICE_KEY = 'flotato.device';
const TAG_KEY = 'flotato.tag';
const POST_TIMEOUT_MS = 4000;

declare const __BUILD__: string;

export interface Rank {
  rank: number;
  total: number;
  tag: string;
}

export interface RunPost {
  device: string;
  tag: string;
  variant: string;
  slot: string;
  build: string;
  run: RunSummary & { countIn?: { onsets: number; r: number } };
  tuning: Tuning;
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** A per-device id, minted once and kept; never tied to a person. */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const id = randomId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'ephemeral-' + randomId();
  }
}

const TAG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Three consonant-ish letters, so a skipped prompt still reads as a tag on the board. */
export function randomTag(): string {
  let tag = '';
  for (let i = 0; i < TAG_LENGTH; i++) tag += TAG_ALPHABET[Math.floor(Math.random() * TAG_ALPHABET.length)];
  return tag;
}

/** Uppercase letters and digits only, at most three. */
export function cleanTag(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, TAG_LENGTH);
}

export function loadTag(): string {
  try {
    const stored = localStorage.getItem(TAG_KEY);
    if (stored && cleanTag(stored) === stored && stored.length > 0) return stored;
  } catch {
    /* storage unavailable */
  }
  return '';
}

export function saveTag(tag: string): void {
  try {
    localStorage.setItem(TAG_KEY, cleanTag(tag));
  } catch {
    /* storage unavailable */
  }
}

/** Posting is on for the deployed site (SITE_ORIGIN); a dev server posts only with `?tune=telemetry=true`. */
export function telemetryAllowed(): boolean {
  try {
    if (location.origin === SITE_ORIGIN) return true;
    const tune = new URLSearchParams(location.search).get('tune') ?? '';
    return tune.split(',').includes('telemetry=true');
  } catch {
    return false;
  }
}

export function buildId(): string {
  try {
    return __BUILD__;
  } catch {
    return 'dev';
  }
}

let warned = false;

/** Sends the run; resolves to its rank in the board window, or null when anything went wrong. */
export async function postRun(post: RunPost): Promise<Rank | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(BOARD_URL + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
      keepalive: true,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('board answered ' + res.status);
    const data = (await res.json()) as Partial<Rank>;
    if (typeof data.rank !== 'number' || typeof data.total !== 'number') return null;
    return { rank: data.rank, total: data.total, tag: typeof data.tag === 'string' ? data.tag : post.tag };
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn('[flotato] run not posted:', err instanceof Error ? err.message : String(err));
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
