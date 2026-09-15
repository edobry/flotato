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
The most recent press wins: holding left and pressing right reverses at once,
and lifting the right thumb hands control back to the left one. Tap or press
Space to start and to retry. M mutes. T opens the tuning overlay.

A run opens with one bar of beat before the first wall (`countInBars`; 0 is
Super Hexagon's immediate start). You can take position during it. After a
death, taps and keys are ignored for 0.7 s so a thumb still held does not
restart the run before the time is read. Hiding the page (lock screen, a
notification, another tab) pauses the run and the music together; coming back
resumes through the same count-in. On phones the key hints are not shown, and
on iOS the ring/silent switch mutes the game.

## Music

The music is synthesized in the browser with Tone.js and driven by game state:
survival time ramps the tempo and transforms the patterns, the nearest wall in
your lane closes the arp's filter, the sector you occupy picks the scale degree
the arp emphasizes, threading a gap fires an accent, death sweeps the mix down,
and a new best gets a stinger. The visual pulse locks to the beat.

Every mapping has a knob. Press T (or open `?tune`) for the tuning overlay; the
values persist in local storage and can be set from the URL as
`?tune=reactivity=0.5,drums=false`. `reactivity=0` turns the engine into a
metronome, which is what Super Hexagon does. The visual pulse is placed on
the audible beat by shifting the Transport phase by the audio output latency;
`beatOffsetMs` adds a manual trim for Bluetooth output, where the reported
latency can be short of the real one.

Patterns are written in a small Tidal-style mini-notation (`src/music/mini.ts`)
over a pure pattern core (`src/music/pattern.ts`) whose query model matches
Strudel's, so the sequencing can grow or be swapped later.

## Run stats

A player observer (`src/player/observer.ts`) rides the same per-frame
snapshot the music reads and reduces each run to a few loop metrics, shown on
the game-over screen: reaction latency from a wall entering your lane to your
first input (median, p90), the share of inputs made before any wall was in
range, how phase-locked your inputs are to the beat (R, 0 to 1, and the mean
offset in beats), overshoots and reversals, and how you died (jitter,
overshoot, wrong way, freeze, late). The block can be hidden with the
`runStats` knob; `dangerOnset` sets where in the danger range a threat begins.
Each run also logs one `[flotato] run` line to the console with the metrics
and the tuning in force, for playtest notes. Nothing is persisted yet.

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
