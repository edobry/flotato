# Flotato

Hexagon-like reflex game (Super Hexagon genre), free web game for friends. The
handoff brief with settled decisions, rationale, and the task list lives in
Notion: https://app.notion.com/p/dobry/Flotato-3da937f03cb4817183e4cb7592ccbbf0
Read it before starting a new task.

## Stack

- Vite + React 19 + TypeScript, canvas 2D, npm.
- Single component in `src/App.tsx`. Game state lives in refs, not React
  state; one requestAnimationFrame loop created once.
- Deploys to GitHub Pages from `main` via `.github/workflows/deploy.yml`.
  Vite `base` is `/flotato/`.

## Settled decisions (do not relitigate; details in the Notion brief)

- Name is Flotato. Played straight: austere neon visuals, serious synths. The
  potato never shows on the surface (hidden easter-egg mode only).
- Music: procedural synthesis in-browser via Tone.js, deeply coupled to game
  state. No Chipzel tracks, no AI-generated music.
- Start screen keeps the credit line: inspired by Terry Cavanagh, creator of
  Super Hexagon, music originally by Chipzel, go buy it.
- PWA, not a native app. No Rust/WASM core. No app-store publication. Free
  web only.
- Keep the runtime crash reporter overlay.

## Task status

1. Scaffold + GitHub Pages deploy: done
2. Rename pass: done
3. Tone.js procedural music engine: done (mt#5151). Design decisions and
   the signal map are on that task's spec; every mapping is a knob in the
   tuning overlay (T, or `?tune`). Re-registered as v2 after the demo
   rehearsal (mt#5181: 130 BPM range, tonal scale, pump, deterministic
   evolution on plateaus); v1 stays selectable for A/B.
4. Player instrumentation, Phase 0 of the attunement vision: done
   (mt#5167). An observer on the same snapshot the music reads computes
   per-run loop metrics (reaction latency, anticipation ratio, beat
   entrainment, overshoots and reversals, death class) for the game-over
   screen. Phases 1 (persisted player model) and 2 (policy mapping the
   model to the tuning knobs) come next; keep the wall ramp fixed so scores
   stay comparable, adapt only the feedback layer.
5. Board backend and projector page for the 2026-09-16 Fractal Tech demo:
   done (mt#5178). Runs POST to a Cloudflare Worker + D1 (`worker/`); the
   `/board/` page is the room's view. Its rows are the first real dataset
   for Phases 1 and 2.
6. The room round for the demo: done (mt#5180). `/room/` on the projector
   runs one shared field; `/pad/` on phones joins with a name, gets a
   cellular-automaton glyph, and sends hold-left/right through a Durable
   Object relay. Deferred by it: the single-player staged entry (mt#5176),
   since the lobby is the staged entry. Later modes floated: tilt and body
   input, each a richer sensor for the player model.
7. Mobile polish / PWA manifest / service worker: done (the crowd-facing
   prerequisites in mt#5173; manifest, icons and service worker in mt#5195).
   Single-player plays offline; board, pad and room stay online-only; a new
   deploy is applied only at a moment that costs no run (`src/update.ts`).
8. localStorage best-time persistence: done (mt#5196). `flotato.best`, shown
   on the start and game-over screens; the tune sheet has its own reset.
9. Potato easter egg mode
10. Backlog: rotation reversals, 60-second level structure, pattern authoring
