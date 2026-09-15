// The room: one Durable Object per room code, relaying between the pads in
// people's hands and the host on the projector. It holds the roster and the
// last state the host announced; it runs no game logic. WebSocket hibernation
// keeps idle connections free, so everything a wake needs lives in storage or
// in each socket's attachment.
//
// Frames are JSON text. Pad → room: join { name, id }, ready { ready },
// dir { d }, ping. Host → room: host {}, state { ... } (opaque, relayed).
// Room → host: roster { players }, joined { player }, left { id },
// ready { id, ready }, dir { id, d }. Room → pad: welcome { you, players,
// state }, state { ... }, roster { players }.

import { DurableObject } from 'cloudflare:workers';

const MAX_FRAME = 4096;
const MAX_NAME = 24;
const MAX_PLAYERS = 64;
const TAG_LENGTH = 3;

export interface Player {
  id: string;
  name: string;
  tag: string;
  ready: boolean;
  connected: boolean;
}

interface Attachment {
  role: 'pad' | 'host';
  id?: string;
}

type Roster = Record<string, Player>;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Names are shown on a projector: bounded, trimmed, printable. */
function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME);
}

function tagOf(name: string): string {
  const t = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, TAG_LENGTH);
  return t || '???';
}

export class Room extends DurableObject {
  private roster: Roster | null = null;
  private lastState: unknown = null;

  private async players(): Promise<Roster> {
    if (this.roster) return this.roster;
    this.roster = ((await this.ctx.storage.get<Roster>('roster')) ?? {}) as Roster;
    // Whoever is not holding a socket after a wake is not connected, whatever storage says.
    const live = new Set<string>();
    for (const ws of this.ctx.getWebSockets('pad')) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.id) live.add(att.id);
    }
    for (const p of Object.values(this.roster)) p.connected = live.has(p.id);
    return this.roster;
  }

  private async save(): Promise<void> {
    if (this.roster) await this.ctx.storage.put('roster', this.roster);
  }

  private send(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }

  private broadcast(tag: 'pad' | 'host', msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(tag)) {
      try {
        ws.send(text);
      } catch {
        /* closing */
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const role = new URL(request.url).searchParams.get('role') === 'host' ? 'host' : 'pad';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role } satisfies Attachment);
    if (role === 'host') {
      // One host at a time: the newest projector wins, older host sockets are closed.
      for (const ws of this.ctx.getWebSockets('host')) {
        if (ws !== server) ws.close(4000, 'replaced by a newer host');
      }
      const players = await this.players();
      this.send(server, { t: 'roster', players: Object.values(players) });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return;
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isObject(msg) || typeof msg.t !== 'string') return;
    const att = (ws.deserializeAttachment() as Attachment | null) ?? { role: 'pad' };
    if (att.role === 'host') return this.fromHost(msg);
    return this.fromPad(ws, att, msg);
  }

  private async fromHost(msg: Record<string, unknown>): Promise<void> {
    if (msg.t === 'state') {
      this.lastState = msg;
      this.broadcast('pad', msg);
    } else if (msg.t === 'reset') {
      // A new round: every ready flag clears; the host tells pads through state.
      const players = await this.players();
      for (const p of Object.values(players)) p.ready = false;
      await this.save();
      this.broadcast('pad', { t: 'roster', players: Object.values(players) });
    }
  }

  private async fromPad(ws: WebSocket, att: Attachment, msg: Record<string, unknown>): Promise<void> {
    const players = await this.players();
    if (msg.t === 'join') {
      const id = typeof msg.id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(msg.id) ? msg.id : null;
      const name = cleanName(msg.name);
      if (!id || !name) {
        this.send(ws, { t: 'error', error: 'name and id required' });
        return;
      }
      const existing = players[id];
      if (!existing && Object.keys(players).length >= MAX_PLAYERS) {
        this.send(ws, { t: 'error', error: 'room is full' });
        return;
      }
      // A reconnect with the same id replaces the old socket, keeping the seat.
      for (const other of this.ctx.getWebSockets('pad')) {
        const o = other.deserializeAttachment() as Attachment | null;
        if (other !== ws && o?.id === id) other.close(4001, 'reconnected elsewhere');
      }
      const player: Player = { id, name, tag: tagOf(name), ready: existing?.ready ?? false, connected: true };
      players[id] = player;
      ws.serializeAttachment({ role: 'pad', id } satisfies Attachment);
      await this.save();
      this.send(ws, { t: 'welcome', you: player, players: Object.values(players), state: this.lastState });
      this.broadcast('host', { t: existing ? 'rejoined' : 'joined', player });
      this.broadcast('pad', { t: 'roster', players: Object.values(players) });
      return;
    }
    const id = att.id;
    const player = id ? players[id] : undefined;
    if (!player) {
      this.send(ws, { t: 'error', error: 'join first' });
      return;
    }
    if (msg.t === 'ready') {
      player.ready = msg.ready === true;
      await this.save();
      this.broadcast('host', { t: 'ready', id: player.id, ready: player.ready });
      this.broadcast('pad', { t: 'roster', players: Object.values(players) });
    } else if (msg.t === 'dir') {
      const d = msg.d === -1 || msg.d === 1 ? msg.d : 0;
      this.broadcast('host', { t: 'dir', id: player.id, d });
    } else if (msg.t === 'ping') {
      this.send(ws, { t: 'pong' });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  private async dropped(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.role !== 'pad' || !att.id) return;
    const players = await this.players();
    const player = players[att.id];
    if (!player) return;
    // Another socket for the same id (a reconnect) keeps the seat live.
    let stillLive = false;
    for (const other of this.ctx.getWebSockets('pad')) {
      const o = other.deserializeAttachment() as Attachment | null;
      if (other !== ws && o?.id === att.id) stillLive = true;
    }
    if (stillLive) return;
    player.connected = false;
    player.ready = false;
    await this.save();
    this.broadcast('host', { t: 'left', id: player.id });
    this.broadcast('pad', { t: 'roster', players: Object.values(players) });
  }
}
