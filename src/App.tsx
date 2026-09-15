import { useRef, useEffect, useState, type CSSProperties } from 'react';
import { createMusicEngine, type MusicEngine, type Snapshot, type WallKind } from './music/engine';
import { DEFAULT_TUNING, loadTuning, resetTuning, saveTuning, type Tuning } from './music/tuning';
import { createObserver, type Observer, type RunSummary } from './player/observer';
import { createInput, type Side } from './input';
import { diffLabel } from './tuning/chips';
import { appendRun, clearRuns, loadRuns, saveRuns, type RunRecord, type Slot } from './tuning/runlog';
import { loadSlots, saveSlots, slotTuning, type Slots } from './tuning/slots';
import { buildId, cleanTag, deviceId, loadTag, postRun, randomTag, saveTag, telemetryAllowed, type Rank } from './telemetry';
import TuningOverlay from './TuningOverlay';
import TuneSheet from './TuneSheet';
import GuideSheet from './GuideSheet';
import { applyVerdict, clearGuide, guideTuning, initialGuide, loadGuide, nextStep, saveGuide, sideTuning, type GuideState, type Side as GuideSide, type Verdict } from './tuning/guide';
import GhostStrip from './GhostStrip';
import RunStats from './RunStats';

const TAU = Math.PI * 2;
const SIDES = 6;
const SECTOR = TAU / SIDES;
const HEX_R = 55;
const PLAYER_R = HEX_R + 16;
const PLAYER_SPEED = 6.8; // radians per second
const HALF_W = 6;         // player collision half-thickness in px
const MILESTONE_S = 10;   // seconds between musical milestones
const DANGER_RANGE = 250; // px over which lane danger ramps from 0 to 1
const BEATS_PER_BAR = 4;
const COUNT_IN_GRACE_S = 1; // seconds to wait for the Transport before the count-in runs on the game clock
const RETRY_LOCKOUT_MS = 700; // after death, before a tap or key can start the next run
const HUD_MARGIN = 16;
const MUTED_KEY = 'flotato.muted';

const KEY_SIDES: Record<string, Side> = {
  ArrowLeft: -1,
  KeyA: -1,
  a: -1,
  A: -1,
  ArrowRight: 1,
  KeyD: 1,
  d: 1,
  D: 1,
};

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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Seconds for a wall to travel `dist` px starting at survival time t0, given wall speed 170 + min(240, 7t). */
function travelTime(dist: number, t0: number): number {
  const T_SAT = 240 / 7;
  if (t0 >= T_SAT) return dist / 410;
  const k = 170 * t0 + 3.5 * t0 * t0 + dist;
  const t = (-170 + Math.sqrt(170 * 170 + 14 * k)) / 7;
  if (t <= T_SAT) return t - t0;
  const covered = 170 * (T_SAT - t0) + 3.5 * (T_SAT * T_SAT - t0 * t0);
  return T_SAT - t0 + (dist - covered) / 410;
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** `?tune=guide` opens the guided listen straight away. */
function guideRequested(): boolean {
  try {
    return (new URLSearchParams(location.search).get('tune') ?? '').split(',').includes('guide');
  } catch {
    return false;
  }
}

function tuningRequested(): boolean {
  try {
    return new URLSearchParams(location.search).has('tune');
  } catch {
    return false;
  }
}

function coarsePointer(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * iOS mutes Web Audio with the ring/silent switch unless the page claims a
 * playback audio session (iOS 17+). Where it cannot, the title says so, since
 * the symptom is indistinguishable from a broken engine. iPadOS reports itself
 * as a Mac; the touch-point count tells them apart.
 */
function silentSwitchMutes(): boolean {
  try {
    const n = navigator;
    const ios = /iP(hone|ad|od)/.test(n.userAgent) || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
    return ios && !('audioSession' in n);
  } catch {
    return false;
  }
}

/** Safe-area insets in px, resolved from the CSS variables index.css sets from env(). */
function readInsets(out: { top: number; right: number; bottom: number; left: number }) {
  try {
    const cs = getComputedStyle(document.documentElement);
    out.top = parseFloat(cs.getPropertyValue('--sat')) || 0;
    out.right = parseFloat(cs.getPropertyValue('--sar')) || 0;
    out.bottom = parseFloat(cs.getPropertyValue('--sab')) || 0;
    out.left = parseFloat(cs.getPropertyValue('--sal')) || 0;
  } catch {
    out.top = out.right = out.bottom = out.left = 0;
  }
}

export default function Flotato() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>('start');
  const [finalTime, setFinalTime] = useState(0);
  const [bestTime, setBestTime] = useState(0);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [retryReady, setRetryReady] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [muted, setMuted] = useState(loadMuted);
  const [tuning, setTuning] = useState<Tuning>(loadTuning);
  const [touch] = useState(coarsePointer);
  // `?tune` is the game master's door: on a fine pointer it opens the side panel, on a phone the sheet.
  const [tuneMode] = useState(tuningRequested);
  const [showTuning, setShowTuning] = useState(() => tuningRequested() && !coarsePointer());
  const [sheetOpen, setSheetOpen] = useState(() => tuningRequested() && coarsePointer() && guideRequested());
  // The guided listen: adaptive pairwise comparisons; state persists so a reload resumes.
  const [guideMode, setGuideMode] = useState(() => tuningRequested() && guideRequested());
  const [guide, setGuide] = useState<GuideState>(loadGuide);
  const [heard, setHeard] = useState<{ id: string; A: boolean; B: boolean }>({ id: '', A: false, B: false });
  const [slots, setSlots] = useState<Slots>(loadSlots);
  const [runs, setRuns] = useState<RunRecord[]>(loadRuns);
  const [slot, setSlot] = useState<Slot>('');
  const [silentHint] = useState(silentSwitchMutes);
  // The board identity: three letters, asked once on the start screen and kept.
  const [tag, setTag] = useState<string>(() => loadTag() || randomTag());
  const [rank, setRank] = useState<Rank | null>(null);

  const phaseRef = useRef<Phase>('start');
  const bestRef = useRef(0);
  const musicRef = useRef<MusicEngine | null>(null);
  const observerRef = useRef<Observer | null>(null);
  const tuningRef = useRef(tuning);
  const mutedRef = useRef(muted);
  const touchRef = useRef(touch);
  const tuneModeRef = useRef(tuneMode);
  const slotRef = useRef<Slot>('');
  const runsRef = useRef(runs);
  const tagRef = useRef(tag);
  // Which run a board answer belongs to, so a slow reply never labels the next run.
  const runSeqRef = useRef(0);
  // The loop's start and stop, for the sheet's play button and the strip's stop button.
  const startRef = useRef<((which: Slot) => void) | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    tagRef.current = tag;
    saveTag(tag);
  }, [tag]);

  useEffect(() => {
    tuningRef.current = tuning;
    musicRef.current?.setTuning(tuning);
    observerRef.current?.configure({ dangerOnset: tuning.dangerOnset });
  }, [tuning]);

  useEffect(() => {
    mutedRef.current = muted;
    musicRef.current?.setMuted(muted);
    try {
      localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [muted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setErr('Canvas 2D context not available in this environment.');
      return;
    }

    const music = createMusicEngine(tuningRef.current);
    musicRef.current = music;
    music.setMuted(mutedRef.current);
    const observer = createObserver({ dangerOnset: tuningRef.current.dangerOnset });
    observerRef.current = observer;

    let raf = 0;
    let stopped = false;
    let hidden = false;
    let w = 0, h = 0, dpr = 1;
    let last = 0;
    const inset = { top: 0, right: 0, bottom: 0, left: 0 };

    const input = createInput();

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

    // What the music engine and the player observer see. One object, rewritten every frame.
    const snap: Snapshot = { t: 0, danger: 0, pressure: 0, sector: 0, lanes: [0, 0, 0, 0, 0, 0], rotDir: 0, camSpin: 0, playing: false };
    const laneMin = new Array<number>(SIDES);
    // The Transport beat phase, read at most once per frame and only when something needs it
    // (the visual pulse, or the observer at an input onset); NaN means not read yet this frame.
    let beat = NaN;
    const beatPhase = () => {
      if (Number.isNaN(beat)) beat = music.beatPhase();
      return beat;
    };
    let nextMilestone = MILESTONE_S;
    let dangerPeakT = -1;
    let dangerPeakSec = -1;
    // Ghost mode is a tune-mode affordance only: the knob persists, but a plain URL never honours it.
    const ghostOn = () => tuneModeRef.current && tuningRef.current.ghost;
    // A run that started in ghost mode never sets a best or logs. Turning ghost off mid-run ends the run.
    let runGhost = false;
    let ghostWas = false;

    // Count-in: beats of audible Transport before the first wall. Measured as
    // beat phase travelled once the Transport starts (absorbing the engine load
    // on the first tap); if it has not started after the grace period, on the
    // game clock instead, so a refused or absent audio context cannot hang the run.
    let countInLeft = 0;
    let countInWaited = 0;
    let countInOnClock = false;
    let lastBeatPhase = -1;
    // The observer starts with the first wall, not the tap: positioning during the count-in is not a reaction.
    let observerPending = false;
    let deadAt = -Infinity;
    let retryTimer = 0;

    const startObserverIfPending = () => {
      if (!observerPending) return;
      observerPending = false;
      observer.start();
    };

    const beginCountIn = () => {
      countInLeft = Math.max(0, Math.round(tuningRef.current.countInBars)) * BEATS_PER_BAR;
      countInWaited = 0;
      countInOnClock = false;
      lastBeatPhase = -1;
      if (countInLeft === 0) startObserverIfPending();
    };

    /** Advances the count-in; true while walls must stay out. */
    const countingIn = (dt: number): boolean => {
      if (countInLeft <= 0) return false;
      const b = beatPhase();
      if (!countInOnClock && b >= 0) {
        if (lastBeatPhase >= 0) countInLeft -= (((b - lastBeatPhase) % 1) + 1) % 1;
        lastBeatPhase = b;
      } else {
        countInWaited += dt;
        if (countInOnClock || countInWaited >= COUNT_IN_GRACE_S) {
          countInOnClock = true;
          countInLeft -= (dt * tuningRef.current.bpmFloor) / 60;
        }
      }
      if (countInLeft > 0) return true;
      countInLeft = 0;
      startObserverIfPending();
      return false;
    };

    const playerSector = () => Math.floor((((s.playerA % TAU) + TAU) % TAU) / SECTOR) % SIDES;

    const canStart = () => phaseRef.current !== 'playing' && performance.now() - deadAt >= RETRY_LOCKOUT_MS;

    /** `which` names the A/B slot the run plays under; a plain tap or key starts under none. */
    const start = (which: Slot = '') => {
      s = freshState();
      nextMilestone = MILESTONE_S;
      dangerPeakT = -1;
      dangerPeakSec = -1;
      runGhost = ghostOn();
      ghostWas = runGhost;
      slotRef.current = which;
      setSlot(which);
      setFinalTime(0);
      setRun(null);
      setRank(null);
      runSeqRef.current++;
      setPhase('playing');
      // A fresh snapshot before the first tick, or the engine would ramp the tempo from the last run's time.
      snap.t = 0;
      snap.danger = 0;
      snap.pressure = 0;
      snap.lanes.fill(0);
      snap.sector = playerSector();
      snap.rotDir = 0;
      snap.camSpin = s.camSpin;
      snap.playing = true;
      music.setSnapshot(snap);
      music.start();
      observerPending = true;
      beginCountIn();
    };
    startRef.current = start;

    /** The death transition. `killed` is false for a ghost run stopped on purpose. */
    const endRun = (killed: boolean) => {
      const ghost = runGhost || ghostOn();
      s.dead = true;
      s.flash = killed ? 0.3 : 0;
      if (killed && !ghost && s.time > bestRef.current) {
        bestRef.current = s.time;
        music.best();
      }
      music.die();
      snap.playing = false;
      music.setSnapshot(snap);
      const summary = observer.die();
      if (killed && !ghost) {
        // One line per run so playtest notes can be tied to the tuning that produced them.
        console.info('[flotato] run', JSON.stringify({ ...summary, tuning: tuningRef.current }));
        setRun(summary);
        if (tuningRef.current.telemetry && telemetryAllowed()) {
          const seq = runSeqRef.current;
          postRun({
            device: deviceId(),
            tag: tagRef.current,
            variant: diffLabel(tuningRef.current),
            slot: slotRef.current,
            build: buildId(),
            run: summary,
            tuning: tuningRef.current,
          }).then((r) => {
            if (r && runSeqRef.current === seq) setRank(r);
          });
        }
        if (tuneModeRef.current) {
          const rec: RunRecord = {
            at: Date.now(),
            time: s.time,
            diff: diffLabel(tuningRef.current),
            slot: slotRef.current,
            tuning: tuningRef.current,
            summary,
          };
          runsRef.current = appendRun(runsRef.current, rec);
          saveRuns(runsRef.current);
          setRuns(runsRef.current);
        }
      } else {
        setRun(null);
      }
      setBestTime(bestRef.current);
      setFinalTime(s.time);
      setPhase('over');
      deadAt = performance.now();
      setRetryReady(false);
      clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => setRetryReady(true), RETRY_LOCKOUT_MS);
    };
    stopRef.current = () => {
      if (phaseRef.current === 'playing' && !s.dead) endRun(false);
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
        readInsets(inset);
      }
    };

    // ---------- input ----------
    const isFormTarget = (e: Event) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON';
    };
    const keySide = (e: KeyboardEvent) => KEY_SIDES[e.code] ?? KEY_SIDES[e.key];
    const keyId = (e: KeyboardEvent) => 'k' + (e.code || e.key);
    const pointerId = (e: PointerEvent) => 'p' + e.pointerId;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isFormTarget(e)) return;
      const c = e.code || '';
      const side = keySide(e);
      if (side !== undefined) {
        input.press(keyId(e), side);
        e.preventDefault();
      } else if (c === 'Space' || c === 'Enter' || e.key === ' ') {
        music.unlock();
        if (canStart()) start();
        e.preventDefault();
      } else if (c === 'KeyM') {
        setMuted((m) => !m);
      } else if (c === 'KeyT') {
        setShowTuning((v) => !v);
      } else if (c === 'Escape') {
        if (ghostOn()) stopRef.current?.();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (keySide(e) !== undefined) input.release(keyId(e));
    };
    const onPointerDown = (e: PointerEvent) => {
      try { wrapRef.current?.focus(); } catch { /* focus can throw in sandboxed frames */ }
      music.unlock();
      if (canStart()) start();
      const rect = canvas.getBoundingClientRect();
      input.press(pointerId(e), e.clientX - rect.left < rect.width / 2 ? -1 : 1);
    };
    const onPointerUp = (e: PointerEvent) => {
      input.release(pointerId(e));
    };
    const onFocusLost = () => {
      input.clear();
    };
    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };
    // A hidden page stops rAF but not the Transport; hold both, and come back
    // through a count-in so the music is not ahead of frozen walls.
    const onHide = () => {
      if (hidden) return;
      hidden = true;
      input.clear();
      if (phaseRef.current === 'playing' && !s.dead) music.pause();
    };
    const onShow = () => {
      if (!hidden) return;
      hidden = false;
      last = 0;
      if (phaseRef.current === 'playing' && !s.dead) {
        music.resume();
        beginCountIn();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
      else onShow();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onFocusLost);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);

    try { wrapRef.current?.focus(); } catch { /* focus can throw in sandboxed frames */ }

    // ---------- wall patterns (always leave a gap) ----------
    const announce = (kind: WallKind, R: number) => {
      music.spawn(kind, s.time + travelTime(R - PLAYER_R, s.time));
    };
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
      announce('ring', R);
    };
    const spawnChunk = (R: number) => {
      const len = Math.random() < 0.5 ? 3 : 4;
      const st0 = Math.floor(Math.random() * SIDES);
      for (let i = 0; i < len; i++) {
        s.walls.push({ sec: (st0 + i) % SIDES, dist: R, thick: 55 });
      }
      announce('chunk', R);
    };
    const spawnSpiral = (R: number) => {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const st0 = Math.floor(Math.random() * SIDES);
      const step = 95 + Math.random() * 40;
      for (let i = 0; i < 5; i++) {
        const sec = (((st0 + dir * i) % SIDES) + SIDES) % SIDES;
        s.walls.push({ sec, dist: R + i * step, thick: 30 });
      }
      announce('spiral', R);
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

      const ghost = ghostOn();
      if (ghostWas && !ghost) {
        endRun(false);
        return;
      }
      ghostWas = ghost;

      const dir = input.direction();
      s.playerA += dir * PLAYER_SPEED * dt;

      // Taking position during the count-in is allowed; nothing else moves,
      // and the music still hears where the player is.
      if (countingIn(dt)) {
        snap.sector = playerSector();
        snap.rotDir = dir;
        snap.camSpin = s.camSpin;
        music.setSnapshot(snap);
        return;
      }

      s.time += dt;
      if (s.time >= nextMilestone) {
        music.milestone(Math.round(nextMilestone / MILESTONE_S));
        nextMilestone += MILESTONE_S;
      }

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

      // where the player is, and how close the walls are (per lane, this lane, and overall)
      const sec = playerSector();
      laneMin.fill(Infinity);
      let anyD = Infinity;
      for (let i = 0; i < s.walls.length; i++) {
        const wl = s.walls[i];
        const d = wl.dist - PLAYER_R;
        if (d + wl.thick < -HALF_W) continue; // already past the player
        if (d < laneMin[wl.sec]) laneMin[wl.sec] = d;
        if (d < anyD) anyD = d;
      }
      for (let i = 0; i < SIDES; i++) {
        snap.lanes[i] = laneMin[i] === Infinity ? 0 : clamp01(1 - laneMin[i] / DANGER_RANGE);
      }
      const danger = snap.lanes[sec];
      const pressure = anyD === Infinity ? 0 : clamp01(1 - anyD / DANGER_RANGE);
      if (danger > 0.6) {
        dangerPeakT = s.time;
        dangerPeakSec = sec;
      } else if (danger < 0.15 && dangerPeakT >= 0) {
        // In ghost mode a wall also clears by passing through, which is not a threaded gap.
        if (s.time - dangerPeakT < 0.35 && (!ghost || sec !== dangerPeakSec)) music.thread();
        dangerPeakT = -1;
      }
      snap.t = s.time;
      snap.danger = danger;
      snap.pressure = pressure;
      snap.sector = sec;
      snap.rotDir = dir;
      snap.camSpin = s.camSpin;
      snap.playing = true;
      music.setSnapshot(snap);
      observer.frame(snap, beatPhase);

      // collision; in ghost mode walls pass through and keep sounding
      if (ghost) return;
      for (let i = 0; i < s.walls.length; i++) {
        const wl = s.walls[i];
        if (
          wl.sec === sec &&
          wl.dist < PLAYER_R + HALF_W &&
          wl.dist + wl.thick > PLAYER_R - HALF_W
        ) {
          endRun(true);
          break;
        }
      }
    };

    // ---------- draw ----------
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const hue = Math.floor(s.hue);
      const b = tuningRef.current.beatPulse ? beatPhase() : -1;
      const pulse = b >= 0 ? 1 + 0.03 * Math.pow(1 - b, 3) : 1 + 0.022 * Math.sin(s.pulseT * 6.2);

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
      ctx.fillStyle = ghostOn() ? 'hsla(' + hue + ', 90%, 82%, 0.45)' : 'hsl(' + hue + ', 90%, 82%)';
      ctx.fill();

      ctx.restore();

      // death flash
      if (s.flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, s.flash * 2.2).toFixed(3) + ')';
        ctx.fillRect(0, 0, w, h);
      }

      // HUD, inside the safe area. Key hints only where there is a keyboard.
      const left = HUD_MARGIN + inset.left;
      const right = w - HUD_MARGIN - inset.right;
      const top = 30 + inset.top;
      const tags: string[] = [];
      if (ghostOn() && phaseRef.current === 'playing') tags.push('GHOST');
      if (slotRef.current && phaseRef.current === 'playing') tags.push(slotRef.current);
      if (mutedRef.current) tags.push(touchRef.current ? 'MUTED' : 'MUTED  M');
      else if (!touchRef.current) tags.push('M mute  T tune');
      const hint = tags.join('   ');
      if (hint) {
        ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(hint, left, top);
      }
      if (phaseRef.current !== 'start') {
        ctx.font = '700 18px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText('TIME ' + s.time.toFixed(2), right, top);
        ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText('BEST ' + bestRef.current.toFixed(2), right, top + 20);
      }
    };

    // ---------- main loop with crash reporting ----------
    const loop = (now: number) => {
      if (stopped) return;
      if (hidden) {
        last = 0;
        raf = requestAnimationFrame(loop);
        return;
      }
      try {
        syncSize();
        if (!last) last = now;
        const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
        last = now;
        beat = NaN;
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
      clearTimeout(retryTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onFocusLost);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      music.dispose();
      startRef.current = null;
      stopRef.current = null;
      if (musicRef.current === music) musicRef.current = null;
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, []);

  const applyTuning = (t: Tuning) => {
    tuningRef.current = t;
    setTuning(t);
    saveTuning(t);
  };
  const resetAll = () => {
    resetTuning();
    applyTuning({ ...DEFAULT_TUNING });
  };
  /** Start from a button: the gesture unlocks audio, a slot's tuning is applied first, the lockout still holds. */
  /** Starts a run under `t`; false when a run is on or the death lockout has not passed. */
  const playWith = (t: Tuning | null, which: Slot): boolean => {
    if (phase === 'playing' || !retryReady) return false;
    if (t) applyTuning(t);
    setSheetOpen(false);
    musicRef.current?.unlock();
    startRef.current?.(which);
    return true;
  };
  const playFrom = (which: Slot) => playWith(slotTuning(slots, which), which);

  const guideStep = guideMode ? nextStep(guide) : null;
  const updateGuide = (next: GuideState) => {
    setGuide(next);
    saveGuide(next);
  };
  const playSide = (side: GuideSide) => {
    if (!guideStep) return;
    // Only a run that actually started counts as heard.
    if (!playWith({ ...sideTuning(guide, guideStep, side), ghost: guide.listen }, side)) return;
    setHeard((h) => (h.id === guideStep.id ? { ...h, [side]: true } : { id: guideStep.id, A: side === 'A', B: side === 'B' }));
  };
  const giveVerdict = (verdict: Verdict) => {
    if (!guideStep) return;
    const next = applyVerdict(guide, guideStep, verdict);
    console.info('[flotato] guide', JSON.stringify({ step: guideStep.id, verdict, base: next.base }));
    updateGuide(next);
    setHeard({ id: '', A: false, B: false });
  };
  const useGuide = () => {
    applyTuning({ ...guideTuning(guide), ghost: false });
    setGuideMode(false);
  };
  const restartGuide = () => {
    clearGuide();
    updateGuide(initialGuide());
    setHeard({ id: '', A: false, B: false });
  };

  const setSlotFromCurrent = (which: 'A' | 'B') => {
    const next = { ...slots, [which]: tuning };
    setSlots(next);
    saveSlots(next);
  };
  const buttonStyle: CSSProperties = { pointerEvents: 'auto', marginTop: 14 };
  const tagRowStyle: CSSProperties = {
    pointerEvents: 'auto',
    marginTop: 16,
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 10,
    fontSize: 14,
    letterSpacing: 3,
  };
  const tagInputStyle: CSSProperties = {
    width: '3.6ch',
    padding: '2px 0',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.45)',
    color: 'inherit',
    font: 'inherit',
    letterSpacing: 'inherit',
    textAlign: 'center',
    textTransform: 'uppercase',
    outline: 'none',
    borderRadius: 0,
  };
  const tuneButton = tuneMode && (
    <button type="button" className="btn" style={buttonStyle} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSheetOpen(true)}>
      tune
    </button>
  );

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
    padding: 'calc(16px + var(--sat)) calc(16px + var(--sar)) calc(16px + var(--sab)) calc(16px + var(--sal))',
  };

  const creditStyle: CSSProperties = {
    position: 'absolute',
    left: 'calc(16px + var(--sal))',
    right: 'calc(16px + var(--sar))',
    bottom: 'calc(18px + var(--sab))',
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
    <div ref={wrapRef} tabIndex={0} className="flotato">
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
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: 6 }}>FLOTATO</div>
          <div style={{ marginTop: 14, fontSize: 14, opacity: 0.85 }}>
            hold the left / right side of the screen
          </div>
          {!touch && <div style={{ fontSize: 14, opacity: 0.85 }}>or use ← → / A D on a keyboard</div>}
          <div style={{ marginTop: 22, fontSize: 15, fontWeight: 700 }}>
            {touch ? 'tap to begin' : 'tap or press SPACE to begin'}
          </div>
          <label style={tagRowStyle} onPointerDown={(e) => e.stopPropagation()}>
            <span style={{ opacity: 0.6 }}>TAG</span>
            <input
              value={tag}
              onChange={(e) => setTag(cleanTag(e.target.value))}
              onBlur={() => {
                if (!tag) setTag(randomTag());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              maxLength={3}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="your three-letter tag for the board"
              style={tagInputStyle}
            />
          </label>
          {silentHint && <div style={{ marginTop: 10, fontSize: 12, opacity: 0.5 }}>the ring/silent switch mutes the game</div>}
          {tuneButton}
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
          {rank && (
            <div style={{ marginTop: 6, fontSize: 14, opacity: 0.85 }}>
              {rank.tag} · #{rank.rank} of {rank.total} tonight
            </div>
          )}
          {tuneMode && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.55, overflowWrap: 'anywhere' }}>
              {slot ? slot + ' · ' : ''}
              {diffLabel(tuning)}
            </div>
          )}
          {run && tuning.runStats && <RunStats run={run} />}
          <div style={{ marginTop: 22, fontSize: 15, fontWeight: 700, opacity: retryReady ? 1 : 0, transition: 'opacity 120ms' }}>
            {touch ? 'tap to retry' : 'tap or press SPACE to retry'}
          </div>
          {tuneMode && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', opacity: retryReady ? 1 : 0, transition: 'opacity 120ms' }}>
              {slots.A && slots.B && (
                <>
                  <button type="button" className="btn" style={buttonStyle} onPointerDown={(e) => e.stopPropagation()} onClick={() => playFrom('A')}>
                    again A
                  </button>
                  <button type="button" className="btn" style={buttonStyle} onPointerDown={(e) => e.stopPropagation()} onClick={() => playFrom('B')}>
                    again B
                  </button>
                </>
              )}
              {tuneButton}
            </div>
          )}
        </div>
      )}
      {showTuning && !err && <TuningOverlay tuning={tuning} onChange={applyTuning} onReset={resetAll} />}
      {tuneMode && touch && phase === 'playing' && tuning.ghost && !err && (
        <GhostStrip tuning={tuning} onChange={applyTuning} onStop={() => stopRef.current?.()} />
      )}
      {/* In guide mode the sheet is simply where the phone rests between runs. */}
      {tuneMode && guideMode && phase !== 'playing' && !err && (
        <GuideSheet
          state={guide}
          step={guideStep}
          heard={heard.id === guideStep?.id ? { A: heard.A, B: heard.B } : { A: false, B: false }}
          onPlay={playSide}
          onVerdict={giveVerdict}
          onListen={(listen) => updateGuide({ ...guide, listen })}
          onUse={useGuide}
          onRestart={restartGuide}
          onBack={() => {
            setGuideMode(false);
            setSheetOpen(true);
          }}
          ready={retryReady}
        />
      )}
      {tuneMode && sheetOpen && phase !== 'playing' && !err && !guideMode && (
        <TuneSheet
          tuning={tuning}
          onChange={applyTuning}
          onReset={resetAll}
          slots={slots}
          onSetSlot={setSlotFromCurrent}
          runs={runs}
          onClearRuns={() => {
            clearRuns();
            runsRef.current = [];
            setRuns([]);
          }}
          onPlay={playFrom}
          onClose={() => setSheetOpen(false)}
          onGuide={() => setGuideMode(true)}
        />
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
