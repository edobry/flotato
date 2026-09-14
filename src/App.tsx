import { useRef, useEffect, useState, type CSSProperties } from 'react';

const TAU = Math.PI * 2;
const SIDES = 6;
const SECTOR = TAU / SIDES;
const HEX_R = 55;
const PLAYER_R = HEX_R + 16;
const PLAYER_SPEED = 6.8; // radians per second
const HALF_W = 6;         // player collision half-thickness in px

type Phase = 'start' | 'playing' | 'over';

interface Wall {
  sec: number;
  dist: number;
  thick: number;
}

interface GameState {
  time: number;
  hue: number;
  camA: number;
  camSpin: number;
  spinT: number;
  pulseT: number;
  playerA: number;
  walls: Wall[];
  dead: boolean;
  flash: number;
}

export default function Flowtato() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>('start');
  const [finalTime, setFinalTime] = useState(0);
  const [bestTime, setBestTime] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const phaseRef = useRef<Phase>('start');
  const bestRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setErr('Canvas 2D context not available in this environment.');
      return;
    }

    let raf = 0;
    let stopped = false;
    let w = 0, h = 0, dpr = 1;
    let last = 0;

    const input = { left: false, right: false };

    const freshState = (): GameState => ({
      time: 0,
      hue: 195,
      camA: Math.random() * TAU,
      camSpin: 0.9,
      spinT: 3,
      pulseT: 0,
      playerA: -TAU / 4,
      walls: [],
      dead: false,
      flash: 0,
    });

    let s = freshState();

    const start = () => {
      s = freshState();
      setFinalTime(0);
      setPhase('playing');
    };

    const syncSize = () => {
      const wrap = wrapRef.current;
      const cw = canvas.clientWidth || (wrap && wrap.clientWidth) || window.innerWidth || 800;
      const ch = canvas.clientHeight || (wrap && wrap.clientHeight) || window.innerHeight || 600;
      const ndpr = Math.min(2, window.devicePixelRatio || 1);
      if (cw !== w || ch !== h || ndpr !== dpr) {
        w = cw;
        h = ch;
        dpr = ndpr;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      }
    };

    // ---------- input ----------
    const onKeyDown = (e: KeyboardEvent) => {
      const c = e.code || '';
      if (c === 'ArrowLeft' || c === 'KeyA' || e.key === 'a' || e.key === 'A') {
        input.left = true;
        e.preventDefault();
      } else if (c === 'ArrowRight' || c === 'KeyD' || e.key === 'd' || e.key === 'D') {
        input.right = true;
        e.preventDefault();
      } else if (c === 'Space' || c === 'Enter' || e.key === ' ') {
        if (phaseRef.current !== 'playing') start();
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const c = e.code || '';
      if (c === 'ArrowLeft' || c === 'KeyA' || e.key === 'a' || e.key === 'A') input.left = false;
      if (c === 'ArrowRight' || c === 'KeyD' || e.key === 'd' || e.key === 'D') input.right = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      try { wrapRef.current?.focus(); } catch { /* focus can throw in sandboxed frames */ }
      if (phaseRef.current !== 'playing') start();
      const rect = canvas.getBoundingClientRect();
      if (e.clientX - rect.left < rect.width / 2) input.left = true;
      else input.right = true;
    };
    const onPointerUp = () => {
      input.left = false;
      input.right = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onPointerUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    try { wrapRef.current?.focus(); } catch { /* focus can throw in sandboxed frames */ }

    // ---------- wall patterns (always leave a gap) ----------
    const spawnRing = (R: number) => {
      const gaps = s.time < 8 || Math.random() < 0.55 ? 2 : 1;
      const open: Record<number, boolean> = {};
      let n = 0;
      while (n < gaps) {
        const g = Math.floor(Math.random() * SIDES);
        if (!open[g]) { open[g] = true; n++; }
      }
      const thick = 32 + Math.random() * 18;
      for (let i = 0; i < SIDES; i++) {
        if (!open[i]) s.walls.push({ sec: i, dist: R, thick });
      }
    };
    const spawnChunk = (R: number) => {
      const len = Math.random() < 0.5 ? 3 : 4;
      const st0 = Math.floor(Math.random() * SIDES);
      for (let i = 0; i < len; i++) {
        s.walls.push({ sec: (st0 + i) % SIDES, dist: R, thick: 55 });
      }
    };
    const spawnSpiral = (R: number) => {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const st0 = Math.floor(Math.random() * SIDES);
      const step = 95 + Math.random() * 40;
      for (let i = 0; i < 5; i++) {
        const sec = (((st0 + dir * i) % SIDES) + SIDES) % SIDES;
        s.walls.push({ sec, dist: R + i * step, thick: 30 });
      }
    };

    // ---------- update ----------
    const update = (dt: number) => {
      s.pulseT += dt;
      s.hue = (s.hue + dt * 16) % 360;
      if (s.flash > 0) s.flash -= dt;

      // camera spin keeps animating even on menus
      s.spinT -= dt;
      if (s.spinT <= 0) {
        s.spinT = 3.5 + Math.random() * 3.5;
        const mag = 0.7 + Math.random() * 0.9 + Math.min(0.8, s.time * 0.02);
        s.camSpin = mag * (Math.random() < 0.5 ? -1 : 1);
      }
      s.camA += s.camSpin * dt;

      if (phaseRef.current !== 'playing' || s.dead) return;

      s.time += dt;

      if (input.left) s.playerA -= PLAYER_SPEED * dt;
      if (input.right) s.playerA += PLAYER_SPEED * dt;

      // walls move inward
      const speed = 170 + Math.min(240, s.time * 7);
      const kept: Wall[] = [];
      for (let i = 0; i < s.walls.length; i++) {
        const wl = s.walls[i];
        wl.dist -= speed * dt;
        if (wl.dist + wl.thick > HEX_R - 6) kept.push(wl);
      }
      s.walls = kept;

      // spawn next pattern when there's room
      const spawnR = Math.hypot(w, h) / 2 + 60;
      const spacing = 330 - Math.min(130, s.time * 4);
      let maxD = 0;
      for (let i = 0; i < s.walls.length; i++) {
        const d = s.walls[i].dist + s.walls[i].thick;
        if (d > maxD) maxD = d;
      }
      if (maxD < spawnR - spacing) {
        const r = Math.random();
        if (r < 0.45) spawnRing(spawnR);
        else if (r < 0.75) spawnChunk(spawnR);
        else spawnSpiral(spawnR);
      }

      // collision
      const a = ((s.playerA % TAU) + TAU) % TAU;
      const sec = Math.floor(a / SECTOR) % SIDES;
      for (let i = 0; i < s.walls.length; i++) {
        const wl = s.walls[i];
        if (
          wl.sec === sec &&
          wl.dist < PLAYER_R + HALF_W &&
          wl.dist + wl.thick > PLAYER_R - HALF_W
        ) {
          s.dead = true;
          s.flash = 0.3;
          if (s.time > bestRef.current) bestRef.current = s.time;
          setBestTime(bestRef.current);
          setFinalTime(s.time);
          setPhase('over');
          break;
        }
      }
    };

    // ---------- draw ----------
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const hue = Math.floor(s.hue);
      const pulse = 1 + 0.022 * Math.sin(s.pulseT * 6.2);

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(s.camA);
      ctx.scale(pulse, pulse);

      const R = Math.hypot(w, h);

      // alternating background wedges
      for (let i = 0; i < SIDES; i++) {
        const a0 = i * SECTOR;
        const a1 = a0 + SECTOR;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
        ctx.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? 'hsl(' + hue + ', 60%, 13%)' : 'hsl(' + hue + ', 60%, 8%)';
        ctx.fill();
      }

      // walls
      ctx.fillStyle = 'hsl(' + hue + ', 85%, 58%)';
      for (let i = 0; i < s.walls.length; i++) {
        const wl = s.walls[i];
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

      // center hexagon
      ctx.beginPath();
      for (let i = 0; i < SIDES; i++) {
        const a = i * SECTOR;
        const x = Math.cos(a) * HEX_R;
        const y = Math.sin(a) * HEX_R;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'hsl(' + hue + ', 60%, 7%)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'hsl(' + hue + ', 85%, 58%)';
      ctx.stroke();

      // player triangle
      const pa = s.playerA;
      const tipR = PLAYER_R + 8;
      const baseR = PLAYER_R - 5;
      const spread = 0.13;
      ctx.beginPath();
      ctx.moveTo(Math.cos(pa) * tipR, Math.sin(pa) * tipR);
      ctx.lineTo(Math.cos(pa - spread) * baseR, Math.sin(pa - spread) * baseR);
      ctx.lineTo(Math.cos(pa + spread) * baseR, Math.sin(pa + spread) * baseR);
      ctx.closePath();
      ctx.fillStyle = 'hsl(' + hue + ', 90%, 82%)';
      ctx.fill();

      ctx.restore();

      // death flash
      if (s.flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, s.flash * 2.2).toFixed(3) + ')';
        ctx.fillRect(0, 0, w, h);
      }

      // HUD
      if (phaseRef.current !== 'start') {
        ctx.font = '700 18px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText('TIME ' + s.time.toFixed(2), w - 16, 30);
        ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText('BEST ' + bestRef.current.toFixed(2), w - 16, 50);
      }
    };

    // ---------- main loop with crash reporting ----------
    const loop = (now: number) => {
      if (stopped) return;
      try {
        syncSize();
        if (!last) last = now;
        const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
        last = now;
        update(dt);
        draw();
      } catch (ex) {
        stopped = true;
        const msg = ex instanceof Error ? ex.stack || ex.message : String(ex);
        setErr(msg);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onPointerUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  const overlayStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    textAlign: 'center',
    pointerEvents: 'none',
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    textShadow: '0 2px 12px rgba(0,0,0,0.8)',
    padding: 16,
  };

  const creditStyle: CSSProperties = {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    fontSize: 12,
    lineHeight: 1.5,
    opacity: 0.6,
    pointerEvents: 'auto',
  };

  const linkStyle: CSSProperties = {
    color: 'inherit',
    textDecoration: 'underline',
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      style={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        background: '#000',
        overflow: 'hidden',
        outline: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
        }}
      />
      {phase === 'start' && !err && (
        <div style={overlayStyle}>
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: 6 }}>FLOWTATO</div>
          <div style={{ marginTop: 14, fontSize: 14, opacity: 0.85 }}>
            hold the left / right side of the screen
          </div>
          <div style={{ fontSize: 14, opacity: 0.85 }}>or use ← → / A D on a keyboard</div>
          <div style={{ marginTop: 22, fontSize: 15, fontWeight: 700 }}>tap or press SPACE to begin</div>
          <div style={creditStyle}>
            inspired by Terry Cavanagh, creator of{' '}
            <a href="https://superhexagon.com" target="_blank" rel="noreferrer" style={linkStyle}>
              Super Hexagon
            </a>{' '}
            — music originally by{' '}
            <a href="https://chipzel.bandcamp.com" target="_blank" rel="noreferrer" style={linkStyle}>
              Chipzel
            </a>
            , go buy it
          </div>
        </div>
      )}
      {phase === 'over' && !err && (
        <div style={overlayStyle}>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 5 }}>GAME OVER</div>
          <div style={{ marginTop: 12, fontSize: 18 }}>TIME {finalTime.toFixed(2)}</div>
          <div style={{ fontSize: 14, opacity: 0.7 }}>BEST {bestTime.toFixed(2)}</div>
          <div style={{ marginTop: 22, fontSize: 15, fontWeight: 700 }}>tap or press SPACE to retry</div>
        </div>
      )}
      {err && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.88)',
            color: '#ff8a8a',
            padding: 16,
            fontFamily: 'monospace',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            overflow: 'auto',
          }}
        >
          {'The game hit a runtime error:\n\n' + err + '\n\nReload to try again.'}
        </div>
      )}
    </div>
  );
}
