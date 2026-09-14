# Flotato

A hexagon-like reflex game, free on the web. Rotate a small triangle around a
central hexagon while wall segments collapse inward; survive as long as you
can. Survival time is the score.

Play it: https://edobry.github.io/flotato/

Inspired by Terry Cavanagh, creator of [Super Hexagon](https://superhexagon.com).
Music originally by [Chipzel](https://chipzel.bandcamp.com), go buy it. This is
a free, non-commercial homage with original code, art, name, and (upcoming)
procedurally synthesized music.

Built with Claude Code from a Claude.ai prototype; the handoff brief and
settled design decisions live in `CLAUDE.md` and the linked Notion page.

## Controls

Hold the left or right half of the screen, or use the arrow keys / A and D.
Tap or press Space to start and to retry. M mutes. T opens the tuning overlay.

## Music

The music is synthesized in the browser with Tone.js and driven by game state:
survival time ramps the tempo and transforms the patterns, the nearest wall in
your lane closes the arp's filter, the sector you occupy picks the scale degree
the arp emphasizes, threading a gap fires an accent, death sweeps the mix down,
and a new best gets a stinger. The visual pulse locks to the beat.

Every mapping has a knob. Press T (or open `?tune`) for the tuning overlay; the
values persist in local storage and can be set from the URL as
`?tune=reactivity=0.5,drums=false`. `reactivity=0` turns the engine into a
metronome, which is what Super Hexagon does.

Patterns are written in a small Tidal-style mini-notation (`src/music/mini.ts`)
over a pure pattern core (`src/music/pattern.ts`) whose query model matches
Strudel's, so the sequencing can grow or be swapped later.

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
