// What pads, the host and the room agree on, and a socket client that keeps
// itself connected. The room only relays; every message here is either a
// pad's intent, the host's announcement, or the roster.

import { ROOM_URL } from '../config';

export const DEFAULT_ROOM = 'fractal';
export const PAD_ID_KEY = 'flotato.pad.id';
export const PAD_NAME_KEY = 'flotato.pad.name';

export interface Player {
  id: string;
  name: string;
  tag: string;
  ready: boolean;
  connected: boolean;
}

export type Phase = 'lobby' | 'countdown' | 'play' | 'over';

export interface PlayerState {
  id: string;
  alive: boolean;
  /** Survival seconds this round; frozen at death. */
  time: number;
  /** Finishing place once dead (1 = last survivor); 0 while alive. */
  place: number;
}

/** The host's announcement, relayed to every pad. */
export interface RoomState {
  t: 'state';
  phase: Phase;
  round: number;
  /** Seconds left in the countdown, when counting down. */
  countdown: number;
  /** Elapsed round seconds while playing. */
  elapsed: number;
  players: PlayerState[];
}

export type PadOut = { t: 'join'; name: string; id: string } | { t: 'ready'; ready: boolean } | { t: 'dir'; d: -1 | 0 | 1 } | { t: 'ping' };
export type HostOut = RoomState | { t: 'reset' };

export type ToPad =
  | { t: 'welcome'; you: Player; players: Player[]; state: RoomState | null }
  | { t: 'roster'; players: Player[] }
  | RoomState
  | { t: 'error'; error: string }
  | { t: 'pong' };

export type ToHost =
  | { t: 'roster'; players: Player[] }
  | { t: 'joined' | 'rejoined'; player: Player }
  | { t: 'left'; id: string }
  | { t: 'ready'; id: string; ready: boolean }
  | { t: 'dir'; id: string; d: -1 | 0 | 1 };

export type SocketStatus = 'connecting' | 'open' | 'closed';

export function roomSocketUrl(code: string, role: 'pad' | 'host'): string {
  const base = ROOM_URL.replace(/^http/, 'ws');
  return `${base}/room/${encodeURIComponent(code)}/ws?role=${role}`;
}

export function roomCodeFromLocation(): string {
  try {
    const code = (new URLSearchParams(location.search).get('room') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    return code.slice(0, 32) || DEFAULT_ROOM;
  } catch {
    return DEFAULT_ROOM;
  }
}

export interface RoomSocket<Out> {
  send(msg: Out): void;
  close(): void;
}

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
const KEEPALIVE_MS = 20000;

/**
 * A WebSocket to the room that reconnects with backoff and pings to stay
 * awake. `onOpen` runs on every (re)connection so the caller can re-join.
 */
export function connectRoom<In, Out>(
  code: string,
  role: 'pad' | 'host',
  handlers: { onMessage: (msg: In) => void; onStatus?: (s: SocketStatus) => void; onOpen?: () => void },
): RoomSocket<Out> {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = RECONNECT_MIN_MS;
  let retry = 0;
  let keepalive = 0;

  const status = (s: SocketStatus) => handlers.onStatus?.(s);

  const open = () => {
    if (closed) return;
    status('connecting');
    const socket = new WebSocket(roomSocketUrl(code, role));
    ws = socket;
    socket.onopen = () => {
      if (ws !== socket) return;
      backoff = RECONNECT_MIN_MS;
      status('open');
      handlers.onOpen?.();
      clearInterval(keepalive);
      keepalive = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN && role === 'pad') socket.send(JSON.stringify({ t: 'ping' }));
      }, KEEPALIVE_MS);
    };
    socket.onmessage = (e) => {
      if (ws !== socket || typeof e.data !== 'string') return;
      try {
        handlers.onMessage(JSON.parse(e.data) as In);
      } catch {
        /* not ours */
      }
    };
    const down = () => {
      if (ws !== socket) return;
      clearInterval(keepalive);
      status('closed');
      if (closed) return;
      retry = window.setTimeout(open, backoff);
      backoff = Math.min(RECONNECT_MAX_MS, backoff * 2);
    };
    socket.onclose = down;
    socket.onerror = () => {
      /* onclose follows */
    };
  };
  open();

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      clearTimeout(retry);
      clearInterval(keepalive);
      ws?.close();
      ws = null;
    },
  };
}
