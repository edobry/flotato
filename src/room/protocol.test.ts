import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectRoom } from './protocol';

/** A WebSocket the test drives: opens on demand, records frames, can be made to hear a message. */
class FakeSocket {
  static all: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  hear(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
  }
}

const KEEPALIVE_MS = 20000;

describe('connectRoom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('pings every 20 s from either role', () => {
    const sock = connectRoom('t', 'host', { onMessage: () => {} });
    const ws = FakeSocket.all[0];
    ws.open();
    vi.advanceTimersByTime(KEEPALIVE_MS * 2);
    expect(ws.sent.filter((f) => f === '{"t":"ping"}')).toHaveLength(2);
    sock.close();
  });

  it('never abandons a socket the room has not answered a ping on', () => {
    const statuses: string[] = [];
    const sock = connectRoom('t', 'host', { onMessage: () => {}, onStatus: (s) => statuses.push(s) });
    FakeSocket.all[0].open();
    vi.advanceTimersByTime(KEEPALIVE_MS * 10);
    expect(FakeSocket.all).toHaveLength(1);
    expect(statuses).toEqual(['connecting', 'open']);
    sock.close();
  });

  it('replaces a socket that answered a ping and then went silent', () => {
    const statuses: string[] = [];
    const sock = connectRoom('t', 'pad', { onMessage: () => {}, onStatus: (s) => statuses.push(s) });
    const first = FakeSocket.all[0];
    first.open();
    vi.advanceTimersByTime(KEEPALIVE_MS);
    first.hear({ t: 'pong' });
    // Two more keepalives with nothing heard: still under the limit, then over it.
    vi.advanceTimersByTime(KEEPALIVE_MS * 2);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(KEEPALIVE_MS);
    expect(first.readyState).toBe(3);
    expect(statuses.at(-1)).toBe('closed');
    vi.advanceTimersByTime(600);
    expect(FakeSocket.all).toHaveLength(2);
    expect(statuses.at(-1)).toBe('connecting');
    sock.close();
  });

  it('keeps a socket that hears anything at all', () => {
    const sock = connectRoom('t', 'pad', { onMessage: () => {} });
    const ws = FakeSocket.all[0];
    ws.open();
    ws.hear({ t: 'pong' });
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(KEEPALIVE_MS * 2);
      ws.hear({ t: 'roster', players: [] });
    }
    expect(FakeSocket.all).toHaveLength(1);
    sock.close();
  });
});
