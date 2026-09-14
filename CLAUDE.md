# Flowtato

Hexagon-like reflex game (Super Hexagon genre), free web game for friends. The
handoff brief with settled decisions, rationale, and the task list lives in
Notion: https://app.notion.com/p/dobry/Flowtato-3da937f03cb4817183e4cb7592ccbbf0
Read it before starting a new task.

## Stack

- Vite + React 19 + TypeScript, canvas 2D, npm.
- Single component in `src/App.tsx`. Game state lives in refs, not React
  state; one requestAnimationFrame loop created once.
- Deploys to GitHub Pages from `main` via `.github/workflows/deploy.yml`.
  Vite `base` is `/flowtato/`.

## Settled decisions (do not relitigate; details in the Notion brief)

- Name is Flowtato. Played straight: austere neon visuals, serious synths. The
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
3. Tone.js procedural music engine: next. Propose the architecture (pattern
   scheduler, which game-state signals drive which musical parameters) and
   discuss before writing code. Eugene wants creative involvement here.
4. Mobile polish / PWA manifest / service worker
5. localStorage best-time persistence
6. Potato easter egg mode
7. Backlog: rotation reversals, 60-second level structure, pattern authoring
