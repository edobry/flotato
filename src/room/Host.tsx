// The room on the projector: one field, one set of walls, one beat, and every
// player's face on the rim. This page owns the game; pads only say which way
// they are holding. Lobby → countdown → play → over → lobby, until the last
// person leaves.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createMusicEngine, type MusicEngine, type Snapshot } from '../music/engine';
import { loadTuning } from '../music/tuning';
import { createObserver, type Observer, type RunSummary } from '../player/observer';
import { buildId, postRun, telemetryAllowed, type Rank } from '../telemetry';
import { GLYPH_SIZE, glyph, glyphColor, glyphSvg } from '../glyph';
import { PLAY_URL } from '../config';
import {
  HEX_R,
  PLAYER_R,
  PLAYER_SPEED,
  SECTOR,
  SIDES,
  TAU,
  advanceWalls,
  hits,
  laneDanger,
  roomToSpawn,
  sectorOf,
  spawnPattern,
  spawnRadius,
  travelTime,
  type Wall,
} from '../game/walls';
import { connectRoom, roomCodeFromLocation, type HostOut, type Phase, type Player, type SocketStatus, type ToHost } from './protocol';
import { sortStandings } from './standings';

const COUNT_IN_BARS = 2; // the round starts on a bar line: two bars of the beat before the first wall
const BEATS_PER_BAR = 4;
const COUNT_IN_GRACE_S = 1; // seconds to wait for the Transport before counting on the game clock
const OVER_S = 7;
const LOBBY_RECAP_S = 25; // the last round's top three stay on the lobby this long
const ROUND_CAP_S = 120;
const STATE_HZ = 4;
const LOBBY_HZ = 1; // pads in the lobby still hear the phase, so a late joiner's text stays live
const ALL_READY_HOLD_S = 3;
const MILESTONE_S = 10;
const DEATH_FADE_S = 0.5;
const QR_SRC = import.meta.env.BASE_URL + 'qr-pad.svg';
const PAD_URL = PLAY_URL + 'pad/';

interface Participant {
  id: string;
  name: string;
  tag: string;
  color: string;
  face: HTMLCanvasElement;
  angle: number;
  dir: -1 | 0 | 1;
  alive: boolean;
  time: number;
  place: number;
  deadAt: number;
  observer: Observer;
  snap: Snapshot;
  dangerPeakT: number;
  summary: RunSummary | null;
  rank: Rank | null;
}

interface ViewPlayer {
  id: string;
  name: string;
  color: string;
  alive: boolean;
  time: number;
  place: number;
  rank: Rank | null;
}

interface RoundView {
  phase: Phase;
  round: number;
  countdown: number;
  elapsed: number;
  overLeft: number;
  players: ViewPlayer[];
  /** The last round's top three, shown on the lobby for a moment. */
  recap: { round: number; top: ViewPlayer[] } | null;
}

const KEYS: [string, string][] = [
  ['SPACE', 'start'],
  ['R', 'end the round'],
  ['M', 'mute'],
  ['ESC', 'hide this'],
];

/** The glyph as a tiny canvas, drawn once per name and blitted every frame. */
function faceCanvas(name: string, color: string): HTMLCanvasElement {
  const g = glyph(name);
  const c = document.createElement('canvas');
  c.width = GLYPH_SIZE;
  c.height = GLYPH_SIZE;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    for (let r = 0; r < GLYPH_SIZE; r++) for (let x = 0; x < GLYPH_SIZE; x++) if (g.cells[r][x]) ctx.fillRect(x, r, 1, 1);
  }
  return c;
}

const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  textShadow: '0 2px 12px rgba(0,0,0,0.8)',
  pointerEvents: 'none',
  textAlign: 'center',
};

export default function Host() {
  const room = useMemo(() => roomCodeFromLocation(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<SocketStatus>('closed');
  const statusRef = useRef<SocketStatus>('closed');
  const [roster, setRoster] = useState<Player[]>([]);
  const [view, setView] = useState<RoundView>({ phase: 'lobby', round: 0, countdown: 0, elapsed: 0, overLeft: 0, players: [], recap: null });
  const [err, setErr] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [allReady, setAllReady] = useState(false);
  // Escape clears the projector down to the bare field; any phase change brings the overlays back.
  const [hidden, setHidden] = useState(false);
  const startRef = useRef<() => void>(() => {});
  const musicRef = useRef<MusicEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setErr('Canvas 2D context not available.');
      return;
    }
    const tuning = loadTuning();
    const music = createMusicEngine(tuning);
    musicRef.current = music;

    // ---------- room ----------
    const players = new Map<string, Player>();
    const pendingDir = new Map<string, -1 | 0 | 1>();
    let rosterDirty = true;
    // Audio needs a gesture on this page; a round must not start silent, so auto-start waits for one.
    let gestured = false;
    const sock = connectRoom<ToHost, HostOut>(room, 'host', {
      onStatus: (s) => {
        statusRef.current = s;
        setStatus(s);
      },
      // Pads hear where the round stands the moment the projector is back.
      onOpen: () => announce(),
      onMessage: (msg) => {
        if (msg.t === 'roster') {
          players.clear();
          for (const p of msg.players) players.set(p.id, p);
          // The room remembers the count across a host reload; it only ever rises.
          if (typeof msg.round === 'number' && msg.round > round) {
            round = msg.round;
            announce();
          }
        } else if (msg.t === 'joined' || msg.t === 'rejoined') {
          players.set(msg.player.id, msg.player);
        } else if (msg.t === 'left') {
          const p = players.get(msg.id);
          if (p) players.set(msg.id, { ...p, connected: false, ready: false });
          pendingDir.set(msg.id, 0);
        } else if (msg.t === 'ready') {
          const p = players.get(msg.id);
          if (p) players.set(msg.id, { ...p, ready: msg.ready });
        } else if (msg.t === 'dir') {
          pendingDir.set(msg.id, msg.d);
          return;
        }
        rosterDirty = true;
      },
    });

    // ---------- round ----------
    let phase: Phase = 'lobby';
    let round = 0;
    let countdown = 0;
    // Count-in in beats, measured as beat phase travelled once the Transport runs; on the game clock after the grace.
    let countInLeft = 0;
    let countInWaited = 0;
    let countInOnClock = false;
    let lastBeat = -1;
    let elapsed = 0;
    let overLeft = 0;
    let recap: RoundView['recap'] = null;
    let recapLeft = 0;
    let allReadyFor = 0;
    let allReadyShown = false;
    let stateTimer = 0;
    let rosterTimer = 0;
    const parts: Participant[] = [];
    let walls: Wall[] = [];
    let hue = 195;
    let camA = Math.random() * TAU;
    let camSpin = 0.9;
    let spinT = 3;
    let pulseT = 0;
    let flash = 0;
    let nextMilestone = MILESTONE_S;
    const lanes = new Array<number>(SIDES).fill(0);
    let beat = NaN;
    const beatPhase = () => {
      if (Number.isNaN(beat)) beat = music.beatPhase();
      return beat;
    };
    let w = 0,
      h = 0,
      dpr = 1;

    const readyPlayers = () => [...players.values()].filter((p) => p.connected && p.ready);

    const viewPlayers = (): ViewPlayer[] =>
      parts.map((p) => ({ id: p.id, name: p.name, color: p.color, alive: p.alive, time: p.alive ? elapsed : p.time, place: p.place, rank: p.rank }));

    const announce = () => {
      sock.send({
        t: 'state',
        phase,
        round,
        countdown,
        elapsed,
        overLeft: phase === 'over' ? overLeft : 0,
        players: parts.map((p) => ({ id: p.id, alive: p.alive, time: p.alive ? elapsed : p.time, place: p.place })),
      });
      setView({ phase, round, countdown, elapsed, overLeft: phase === 'over' ? overLeft : 0, players: viewPlayers(), recap });
    };

    const enterPhase = (next: Phase) => {
      phase = next;
      setHidden(false);
    };

    const beginCountdown = () => {
      const ready = readyPlayers();
      if (ready.length === 0 || phase !== 'lobby') return;
      round++;
      parts.length = 0;
      const n = ready.length;
      ready.forEach((p, i) => {
        const color = glyphColor(p.name);
        parts.push({
          id: p.id,
          name: p.name,
          tag: p.tag,
          color,
          face: faceCanvas(p.name, color),
          // Spread everyone round the rim so nobody starts on top of anyone.
          angle: -TAU / 4 + (i / n) * TAU,
          dir: pendingDir.get(p.id) ?? 0,
          alive: true,
          time: 0,
          place: 0,
          deadAt: -1,
          observer: createObserver({ dangerOnset: tuning.dangerOnset }),
          snap: { t: 0, danger: 0, pressure: 0, sector: 0, lanes, rotDir: 0, camSpin: 0, playing: true },
          dangerPeakT: -1,
          summary: null,
          rank: null,
        });
      });
      walls = [];
      elapsed = 0;
      countInLeft = COUNT_IN_BARS * BEATS_PER_BAR;
      countInWaited = 0;
      countInOnClock = false;
      lastBeat = -1;
      countdown = (countInLeft * 60) / tuning.bpmFloor;
      nextMilestone = MILESTONE_S;
      recap = null;
      enterPhase('countdown');
      music.start();
      announce();
    };
    startRef.current = beginCountdown;

    const beginPlay = () => {
      enterPhase('play');
      for (const p of parts) p.observer.start();
      announce();
    };

    const die = (p: Participant) => {
      p.alive = false;
      p.time = elapsed;
      p.deadAt = elapsed;
      p.place = parts.filter((q) => q.alive).length + 1;
      p.snap.playing = false;
      p.summary = p.observer.die();
      flash = 0.25;
      if (tuning.telemetry && telemetryAllowed()) {
        const roundOf = round;
        postRun({ device: p.id, tag: p.tag, variant: 'room', slot: '', build: buildId(), run: p.summary, tuning }).then((r) => {
          if (r && round === roundOf) p.rank = r;
        });
      }
    };

    const endRound = () => {
      // Survivors at the cap share first place; the last one standing is first.
      for (const p of parts) {
        if (p.alive) {
          p.time = elapsed;
          p.place = 1;
          p.summary = p.observer.die();
        }
      }
      music.die();
      enterPhase('over');
      overLeft = OVER_S;
      announce();
    };

    const backToLobby = () => {
      if (parts.length > 0) {
        recap = { round, top: sortStandings(viewPlayers()).slice(0, 3) };
        recapLeft = LOBBY_RECAP_S;
      }
      enterPhase('lobby');
      parts.length = 0;
      walls = [];
      sock.send({ t: 'reset' });
      for (const [id, p] of players) players.set(id, { ...p, ready: false });
      rosterDirty = true;
      announce();
    };

    // R: the round is over now, whoever is still in; straight back to the lobby, nothing posted.
    const abortRound = () => {
      if (phase === 'lobby') return;
      if (phase !== 'over') {
        for (const p of parts) {
          if (p.alive) {
            p.time = elapsed;
            p.place = 1;
          }
        }
        music.die();
      }
      backToLobby();
    };

    // ---------- frame ----------
    const syncSize = () => {
      const cw = canvas.clientWidth || window.innerWidth;
      const ch = canvas.clientHeight || window.innerHeight;
      const ndpr = Math.min(2, window.devicePixelRatio || 1);
      if (cw !== w || ch !== h || ndpr !== dpr) {
        w = cw;
        h = ch;
        dpr = ndpr;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      }
    };

    const update = (dt: number) => {
      pulseT += dt;
      hue = (hue + dt * 16) % 360;
      if (flash > 0) flash -= dt;
      spinT -= dt;
      if (spinT <= 0) {
        spinT = 3.5 + Math.random() * 3.5;
        const mag = 0.7 + Math.random() * 0.9 + Math.min(0.8, elapsed * 0.02);
        camSpin = mag * (Math.random() < 0.5 ? -1 : 1);
      }
      camA += camSpin * dt;

      for (const p of parts) {
        const d = pendingDir.get(p.id);
        if (d !== undefined) p.dir = d;
      }

      if (phase === 'lobby') {
        if (recap) {
          recapLeft -= dt;
          if (recapLeft <= 0) recap = null;
        }
        const connected = [...players.values()].filter((p) => p.connected);
        const ready = connected.filter((p) => p.ready);
        // Everyone here is ready: give stragglers a moment, then go without a keypress.
        const everyone = gestured && connected.length >= 2 && ready.length === connected.length;
        if (everyone) {
          allReadyFor += dt;
          if (allReadyFor >= ALL_READY_HOLD_S) beginCountdown();
        } else {
          allReadyFor = 0;
        }
        if (everyone !== allReadyShown) {
          allReadyShown = everyone;
          setAllReady(everyone);
        }
        return;
      }

      if (phase === 'countdown') {
        const b = beatPhase();
        if (!countInOnClock && b >= 0) {
          if (lastBeat >= 0) countInLeft -= (((b - lastBeat) % 1) + 1) % 1;
          lastBeat = b;
        } else {
          countInWaited += dt;
          if (countInOnClock || countInWaited >= COUNT_IN_GRACE_S) {
            countInOnClock = true;
            countInLeft -= (dt * tuning.bpmFloor) / 60;
          }
        }
        countdown = Math.max(0, (countInLeft * 60) / tuning.bpmFloor);
        for (const p of parts) p.angle += p.dir * PLAYER_SPEED * dt;
        if (countInLeft <= 0) {
          countdown = 0;
          beginPlay();
        }
        return;
      }

      if (phase === 'over') {
        overLeft -= dt;
        if (overLeft <= 0) backToLobby();
        return;
      }

      // play
      elapsed += dt;
      if (elapsed >= nextMilestone) {
        music.milestone(Math.round(nextMilestone / MILESTONE_S));
        nextMilestone += MILESTONE_S;
      }
      walls = advanceWalls(walls, dt, elapsed);
      const R = spawnRadius(w, h);
      if (roomToSpawn(walls, R, elapsed)) {
        const spawned = spawnPattern(R, elapsed, Math.random);
        for (const wl of spawned.walls) walls.push(wl);
        music.spawn(spawned.kind, elapsed + travelTime(R - PLAYER_R, elapsed));
      }
      const pressure = laneDanger(walls, lanes);

      let roomDanger = 0;
      let leadSector = 0;
      let leadSet = false;
      const bp = beatPhase();
      for (const p of parts) {
        if (!p.alive) continue;
        p.angle += p.dir * PLAYER_SPEED * dt;
        const sec = sectorOf(p.angle);
        const danger = lanes[sec];
        if (danger > roomDanger) roomDanger = danger;
        if (!leadSet) {
          leadSector = sec;
          leadSet = true;
        }
        if (danger > 0.6) p.dangerPeakT = elapsed;
        else if (danger < 0.15 && p.dangerPeakT >= 0) {
          if (elapsed - p.dangerPeakT < 0.35) music.thread();
          p.dangerPeakT = -1;
        }
        p.snap.t = elapsed;
        p.snap.danger = danger;
        p.snap.pressure = pressure;
        p.snap.sector = sec;
        p.snap.rotDir = p.dir;
        p.snap.camSpin = camSpin;
        p.observer.frame(p.snap, () => bp);
        if (hits(walls, sec)) die(p);
      }
      // The music hears the room: the tightest lane anyone is in, and the first survivor's sector.
      music.setSnapshot({ t: elapsed, danger: roomDanger, pressure, sector: leadSector, lanes, rotDir: 0, camSpin, playing: true });

      if (!parts.some((p) => p.alive) || elapsed >= ROUND_CAP_S) endRound();
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const hu = Math.floor(hue);
      const b = tuning.beatPulse ? beatPhase() : -1;
      const pulse = b >= 0 ? 1 + 0.03 * Math.pow(1 - b, 3) : 1 + 0.022 * Math.sin(pulseT * 6.2);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(camA);
      ctx.scale(pulse, pulse);
      const R = Math.hypot(w, h);
      for (let i = 0; i < SIDES; i++) {
        const a0 = i * SECTOR;
        const a1 = a0 + SECTOR;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
        ctx.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? `hsl(${hu}, 60%, 13%)` : `hsl(${hu}, 60%, 8%)`;
        ctx.fill();
      }
      ctx.fillStyle = `hsl(${hu}, 85%, 58%)`;
      for (const wl of walls) {
        const inner = Math.max(wl.dist, HEX_R * 0.85);
        const outer = wl.dist + wl.thick;
        if (outer <= inner) continue;
        const a0 = wl.sec * SECTOR - 0.008;
        const a1 = (wl.sec + 1) * SECTOR + 0.008;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
        ctx.lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner);
        ctx.lineTo(Math.cos(a1) * outer, Math.sin(a1) * outer);
        ctx.lineTo(Math.cos(a0) * outer, Math.sin(a0) * outer);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      for (let i = 0; i < SIDES; i++) {
        const a = i * SECTOR;
        if (i === 0) ctx.moveTo(Math.cos(a) * HEX_R, Math.sin(a) * HEX_R);
        else ctx.lineTo(Math.cos(a) * HEX_R, Math.sin(a) * HEX_R);
      }
      ctx.closePath();
      ctx.fillStyle = `hsl(${hu}, 60%, 7%)`;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = `hsl(${hu}, 85%, 58%)`;
      ctx.stroke();

      // Players: a triangle on the rim in their colour, their face just outside it.
      for (const p of parts) {
        const age = p.alive ? 0 : elapsed - p.deadAt;
        if (!p.alive && age > DEATH_FADE_S) continue;
        ctx.save();
        ctx.globalAlpha = p.alive ? 1 : Math.max(0, 1 - age / DEATH_FADE_S);
        const pa = p.angle;
        const tipR = PLAYER_R + 8;
        const baseR = PLAYER_R - 5;
        const spread = 0.13;
        ctx.beginPath();
        ctx.moveTo(Math.cos(pa) * tipR, Math.sin(pa) * tipR);
        ctx.lineTo(Math.cos(pa - spread) * baseR, Math.sin(pa - spread) * baseR);
        ctx.lineTo(Math.cos(pa + spread) * baseR, Math.sin(pa + spread) * baseR);
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
        const fr = PLAYER_R + 34;
        ctx.translate(Math.cos(pa) * fr, Math.sin(pa) * fr);
        ctx.rotate(-camA);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(p.face, -12, -12, 24, 24);
        ctx.restore();
      }
      ctx.restore();

      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, flash * 1.6).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }

      // HUD
      ctx.font = '700 22px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      if (phase === 'play' || phase === 'over') ctx.fillText('TIME ' + elapsed.toFixed(2), w - 20, 40);
      ctx.font = '600 14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      if (round > 0) ctx.fillText('ROUND ' + round, w - 20, 62);
      ctx.textAlign = 'left';
      ctx.fillText(`room ${room} · ${statusRef.current === 'open' ? 'live' : statusRef.current}${isMuted ? ' · muted' : ''}`, 20, 30);
    };

    let raf = 0;
    let stopped = false;
    let last = 0;
    const loop = (now: number) => {
      if (stopped) return;
      try {
        syncSize();
        if (!last) last = now;
        const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
        last = now;
        beat = NaN;
        update(dt);
        draw();
        stateTimer += dt;
        if (stateTimer >= 1 / (phase === 'lobby' ? LOBBY_HZ : STATE_HZ)) {
          stateTimer = 0;
          announce();
        }
        rosterTimer += dt;
        if (rosterDirty && rosterTimer >= 0.25) {
          rosterTimer = 0;
          rosterDirty = false;
          setRoster([...players.values()]);
        }
      } catch (ex) {
        stopped = true;
        setErr(ex instanceof Error ? ex.stack || ex.message : String(ex));
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    let isMuted = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        music.unlock();
        gestured = true;
        setUnlocked(true);
        beginCountdown();
        e.preventDefault();
      } else if (e.code === 'KeyM') {
        isMuted = !isMuted;
        music.setMuted(isMuted);
      } else if (e.code === 'KeyR') {
        abortRound();
      } else if (e.code === 'Escape') {
        setHidden((h) => !h);
      }
    };
    const onPointer = () => {
      music.unlock();
      gestured = true;
      setUnlocked(true);
      if (phase === 'lobby') beginCountdown();
    };
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('pointerdown', onPointer);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('pointerdown', onPointer);
      sock.close();
      music.dispose();
    };
  }, [room]);

  const connected = roster.filter((p) => p.connected);
  const readyCount = connected.filter((p) => p.ready).length;
  const standings = sortStandings(view.players);
  const show = !err && !hidden;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100dvh', background: '#000', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {view.phase === 'lobby' && show && (
        <div style={overlay}>
          <div style={{ display: 'flex', gap: '5vw', alignItems: 'center' }}>
            <div>
              <img src={QR_SRC} alt={'QR code for ' + PAD_URL} style={{ width: '32vh', display: 'block', imageRendering: 'pixelated' }} />
              <div style={{ marginTop: 10, fontSize: 16, opacity: 0.7 }}>
                {PAD_URL.replace('https://', '')}
                {room === 'fractal' ? '' : '?room=' + room}
              </div>
            </div>
            <div style={{ textAlign: 'left', minWidth: '30vw' }}>
              <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 8 }}>FLOTATO</div>
              <div style={{ fontSize: 16, opacity: 0.6, marginTop: 4 }}>
                room {room} · {connected.length} here · {readyCount} ready{status === 'open' ? '' : ' · ' + status}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 22, maxWidth: '44vw' }}>
                {connected.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: p.ready ? 1 : 0.45 }}>
                    <span style={{ width: 28, height: 28, display: 'inline-block' }} dangerouslySetInnerHTML={{ __html: glyphSvg(p.name, 28, glyphColor(p.name)) }} />
                    <span style={{ fontSize: 15, color: glyphColor(p.name) }}>{p.name}</span>
                    {p.ready && <span style={{ fontSize: 12, opacity: 0.7 }}>ready</span>}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 26, fontSize: 15, fontWeight: 700 }}>
                {!unlocked ? 'tap or press SPACE once to wake the sound' : allReady ? `everyone is ready · starting in ${ALL_READY_HOLD_S}s, or SPACE now` : readyCount > 0 ? 'SPACE starts the round' : 'waiting for the room to ready up'}
              </div>
              {view.recap ? (
                <div style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6 }}>
                  <div style={{ opacity: 0.5 }}>round {view.recap.round}</div>
                  {view.recap.top.map((p, i) => (
                    <div key={p.id} style={{ color: p.color }}>
                      #{i + 1} {p.name} · {p.time.toFixed(2)}
                    </div>
                  ))}
                </div>
              ) : (
                view.round > 0 && <div style={{ marginTop: 6, fontSize: 13, opacity: 0.5 }}>round {view.round} done</div>
              )}
            </div>
          </div>
          <div style={{ position: 'absolute', left: 20, bottom: 16, fontSize: 12, opacity: 0.4, textAlign: 'left', lineHeight: 1.7 }}>
            {KEYS.map(([key, what]) => (
              <div key={key}>
                <span style={{ display: 'inline-block', minWidth: 52, fontWeight: 700 }}>{key}</span>
                {what}
              </div>
            ))}
          </div>
        </div>
      )}

      {view.phase === 'countdown' && show && (
        <div style={overlay}>
          <div style={{ fontSize: '18vh', fontWeight: 800 }}>{Math.max(1, Math.ceil(view.countdown))}</div>
          <div style={{ fontSize: 18, opacity: 0.7 }}>{view.players.length} in · on the next bar</div>
        </div>
      )}

      {(view.phase === 'play' || view.phase === 'over') && show && (
        <div style={{ position: 'absolute', top: 80, right: 20, textAlign: 'right', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', pointerEvents: 'none' }}>
          {standings.map((p) => (
            <div key={p.id} style={{ fontSize: 15, lineHeight: 1.6, opacity: p.alive ? 1 : 0.5, color: p.alive ? p.color : '#fff' }}>
              {p.name} {p.alive ? '' : p.time.toFixed(2)}
              {!p.alive && p.place ? ` · #${p.place}` : ''}
            </div>
          ))}
        </div>
      )}

      {view.phase === 'over' && show && (
        <div style={overlay}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 6 }}>ROUND {view.round}</div>
          <div style={{ marginTop: 18, fontSize: 20, lineHeight: 1.7 }}>
            {standings.slice(0, 8).map((p) => (
              <div key={p.id} style={{ color: p.color }}>
                #{p.place || 1} {p.name} · {p.time.toFixed(2)}
                {p.rank ? <span style={{ opacity: 0.55, fontSize: 15 }}>{`  · #${p.rank.rank} of ${p.rank.total} tonight`}</span> : null}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, fontSize: 14, opacity: 0.6 }}>next lobby in {Math.max(1, Math.ceil(view.overLeft))} s</div>
        </div>
      )}

      {err && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.88)', color: '#ff8a8a', padding: 16, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', overflow: 'auto' }}>
          {'The room hit a runtime error:\n\n' + err + '\n\nReload to try again.'}
        </div>
      )}
    </div>
  );
}
