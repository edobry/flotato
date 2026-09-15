// The phone in the room: type a name, get a face, ready up, then hold left
// or right and look at the projector. The pad shows only what the projector
// cannot: your own phase, and your time when you fall.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createInput } from '../input';
import { glyphColor, glyphSvg } from '../glyph';
import {
  PAD_ID_KEY,
  PAD_NAME_KEY,
  connectRoom,
  roomCodeFromLocation,
  type PadOut,
  type Player,
  type PlayerState,
  type RoomState,
  type SocketStatus,
  type ToPad,
} from '../room/protocol';

type Screen = 'enter' | 'lobby' | 'countdown' | 'play' | 'dead' | 'over';

function randomId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function padId(): string {
  try {
    const stored = localStorage.getItem(PAD_ID_KEY);
    if (stored) return stored;
    const id = randomId();
    localStorage.setItem(PAD_ID_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

function loadName(): string {
  try {
    return localStorage.getItem(PAD_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(PAD_NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

const page: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
  background: '#000',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  textAlign: 'center',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  touchAction: 'none',
};

const big: CSSProperties = { fontSize: 30, fontWeight: 800, letterSpacing: 5 };
const dim: CSSProperties = { fontSize: 14, opacity: 0.6, lineHeight: 1.5 };
const button: CSSProperties = {
  font: 'inherit',
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: 3,
  padding: '18px 34px',
  background: 'transparent',
  color: '#fff',
  border: '2px solid rgba(255,255,255,0.7)',
  borderRadius: 8,
  touchAction: 'manipulation',
};
const input: CSSProperties = {
  font: 'inherit',
  fontSize: 22,
  letterSpacing: 2,
  width: 'min(80vw, 320px)',
  padding: '10px 12px',
  background: 'transparent',
  color: '#fff',
  border: 'none',
  borderBottom: '2px solid rgba(255,255,255,0.5)',
  textAlign: 'center',
  outline: 'none',
  borderRadius: 0,
};

export default function Pad() {
  const room = useMemo(() => roomCodeFromLocation(), []);
  const id = useMemo(() => padId(), []);
  const [name, setName] = useState(loadName);
  const [screen, setScreen] = useState<Screen>('enter');
  const [status, setStatus] = useState<SocketStatus>('closed');
  const [you, setYou] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [state, setState] = useState<RoomState | null>(null);
  const [mine, setMine] = useState<PlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sockRef = useRef<ReturnType<typeof connectRoom<ToPad, PadOut>> | null>(null);
  const joinedRef = useRef(false);
  const nameRef = useRef(name);
  const screenRef = useRef<Screen>('enter');
  const lastDir = useRef<-1 | 0 | 1>(0);
  const inputRef = useRef(createInput());

  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const trimmed = name.trim();
  const svg = useMemo(() => (trimmed ? glyphSvg(trimmed, 120, glyphColor(trimmed)) : ''), [trimmed]);

  // Derive the pad's screen from the host's state and our seat in it.
  useEffect(() => {
    if (!joinedRef.current || !state) return;
    const me = state.players.find((p) => p.id === id) ?? null;
    setMine(me);
    const was = screenRef.current;
    let next: Screen;
    if (state.phase === 'lobby') next = 'lobby';
    else if (state.phase === 'countdown') next = me ? 'countdown' : 'lobby';
    else if (state.phase === 'play') next = me ? (me.alive ? 'play' : 'dead') : 'lobby';
    else next = me ? 'over' : 'lobby';
    if (next !== was) {
      if (next === 'dead') vibrate([60, 40, 120]);
      if (next === 'countdown') vibrate(30);
      setScreen(next);
      if (next !== 'play') {
        inputRef.current.clear();
        lastDir.current = 0;
      }
    }
  }, [state, id]);

  const join = () => {
    const n = name.trim();
    if (!n) return;
    saveName(n);
    setError(null);
    joinedRef.current = true;
    setScreen('lobby');
    if (sockRef.current) {
      sockRef.current.send({ t: 'join', name: n, id });
      return;
    }
    sockRef.current = connectRoom<ToPad, PadOut>(room, 'pad', {
      onStatus: setStatus,
      onOpen: () => {
        if (joinedRef.current) sockRef.current?.send({ t: 'join', name: nameRef.current.trim(), id });
      },
      onMessage: (msg) => {
        if (msg.t === 'welcome') {
          setYou(msg.you);
          setPlayers(msg.players);
          if (msg.state) setState(msg.state);
        } else if (msg.t === 'roster') {
          setPlayers(msg.players);
          const me = msg.players.find((p) => p.id === id);
          if (me) setYou(me);
        } else if (msg.t === 'state') {
          setState(msg);
        } else if (msg.t === 'error') {
          setError(msg.error);
        }
      },
    });
  };

  useEffect(() => () => sockRef.current?.close(), []);

  const setReady = (ready: boolean) => {
    sockRef.current?.send({ t: 'ready', ready });
    setYou((y) => (y ? { ...y, ready } : y));
  };

  // The controller: two halves, press-order input, direction sent only on change.
  const flush = () => {
    const d = inputRef.current.direction();
    if (d !== lastDir.current) {
      lastDir.current = d;
      sockRef.current?.send({ t: 'dir', d });
    }
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (screenRef.current !== 'play') return;
    const rect = e.currentTarget.getBoundingClientRect();
    inputRef.current.press('p' + e.pointerId, e.clientX - rect.left < rect.width / 2 ? -1 : 1);
    flush();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    inputRef.current.release('p' + e.pointerId);
    flush();
  };

  useEffect(() => {
    const sides: Record<string, -1 | 1> = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
    const down = (e: KeyboardEvent) => {
      const s = sides[e.code];
      if (s === undefined || screenRef.current !== 'play') return;
      inputRef.current.press('k' + e.code, s);
      flush();
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (sides[e.code] === undefined) return;
      inputRef.current.release('k' + e.code);
      flush();
    };
    const lost = () => {
      inputRef.current.clear();
      flush();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', lost);
    document.addEventListener('visibilitychange', lost);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', lost);
      document.removeEventListener('visibilitychange', lost);
    };
  }, []);

  // Keep the screen on while playing, where supported.
  useEffect(() => {
    if (screen !== 'play' && screen !== 'countdown') return;
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((l) => {
        lock = l;
      })
      .catch(() => {
        /* denied */
      });
    return () => {
      lock?.release().catch(() => {
        /* already released */
      });
    };
  }, [screen]);

  const readyCount = players.filter((p) => p.ready && p.connected).length;
  const hereCount = players.filter((p) => p.connected).length;
  const link = status === 'open' ? null : status === 'connecting' ? 'connecting…' : 'reconnecting…';
  const color = trimmed ? glyphColor(trimmed) : '#fff';

  if (screen === 'enter') {
    return (
      <div style={page}>
        <div style={big}>FLOTATO</div>
        <div style={dim}>room {room}</div>
        <div style={{ height: 120 }} dangerouslySetInnerHTML={{ __html: svg }} />
        <input
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') join();
          }}
          placeholder="your name"
          autoCapitalize="words"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="your name"
        />
        <div style={dim}>the name becomes your face</div>
        <button type="button" style={{ ...button, opacity: trimmed ? 1 : 0.4 }} onClick={join} disabled={!trimmed}>
          JOIN
        </button>
        {error && <div style={{ ...dim, color: '#ff8a8a' }}>{error}</div>}
      </div>
    );
  }

  const face = <div style={{ height: 96 }} dangerouslySetInnerHTML={{ __html: trimmed ? glyphSvg(trimmed, 96, color) : '' }} />;

  if (screen === 'lobby') {
    const ready = you?.ready ?? false;
    return (
      <div style={page}>
        {face}
        <div style={{ ...big, color }}>{you?.name ?? trimmed}</div>
        <div style={dim}>
          {hereCount} here · {readyCount} ready
          {state?.phase === 'play' ? ' · a round is on, you are in the next' : ''}
        </div>
        <button
          type="button"
          style={{ ...button, background: ready ? color : 'transparent', color: ready ? '#000' : '#fff', borderColor: color }}
          onClick={() => setReady(!ready)}
        >
          {ready ? 'READY' : 'READY?'}
        </button>
        <div style={dim}>{link ?? 'watch the screen'}</div>
        {error && <div style={{ ...dim, color: '#ff8a8a' }}>{error}</div>}
      </div>
    );
  }

  if (screen === 'countdown') {
    return (
      <div style={page}>
        {face}
        <div style={{ ...big, color }}>{state ? Math.ceil(state.countdown) : ''}</div>
        <div style={dim}>hold left or right · eyes on the screen</div>
      </div>
    );
  }

  if (screen === 'play') {
    return (
      <div style={{ ...page, padding: 0, gap: 0, flexDirection: 'row' }} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div style={{ flex: 1, height: '100%', display: 'grid', placeItems: 'center', borderRight: '1px solid rgba(255,255,255,0.12)', fontSize: 64, opacity: 0.35 }}>
          ‹
        </div>
        <div style={{ flex: 1, height: '100%', display: 'grid', placeItems: 'center', fontSize: 64, opacity: 0.35 }}>›</div>
        <div style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', left: 0, right: 0, pointerEvents: 'none' }}>
          <div style={{ ...dim, color }}>{you?.name}</div>
        </div>
      </div>
    );
  }

  if (screen === 'dead') {
    return (
      <div style={page}>
        {face}
        <div style={big}>{mine ? mine.time.toFixed(2) : ''}</div>
        <div style={dim}>
          {mine?.place ? `#${mine.place} this round` : ''}
          <br />
          {state ? `${state.players.filter((p) => p.alive).length} still in` : ''}
          <br />
          you're in the next round
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      {face}
      <div style={big}>{mine ? mine.time.toFixed(2) : ''}</div>
      <div style={dim}>
        {mine?.place ? `#${mine.place} of ${state?.players.length ?? 0}` : ''}
        <br />
        next round soon
      </div>
    </div>
  );
}
