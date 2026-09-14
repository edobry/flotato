# Flowtato

A hexagon-like reflex game, free on the web. Rotate a small triangle around a
central hexagon while wall segments collapse inward; survive as long as you
can. Survival time is the score.

Play it: https://edobry.github.io/flowtato/

Inspired by Terry Cavanagh, creator of [Super Hexagon](https://superhexagon.com).
Music originally by [Chipzel](https://chipzel.bandcamp.com), go buy it. This is
a free, non-commercial homage with original code, art, name, and (upcoming)
procedurally synthesized music.

Built with Claude Code from a Claude.ai prototype; the handoff brief and
settled design decisions live in `CLAUDE.md` and the linked Notion page.

## Controls

Hold the left or right half of the screen, or use the arrow keys / A and D.
Tap or press Space to start and to retry.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
npm run lint
```

## Deploy

Every push to `main` builds and deploys to GitHub Pages through
`.github/workflows/deploy.yml`.
