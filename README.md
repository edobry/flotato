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
Space to start and to retry. M mutes. T opens the tuning panel (see Tuning).

A run opens with one bar of beat before the first wall (`countInBars`; 0 is
Super Hexagon's immediate start). You can take position during it. After a
death, taps and keys are ignored for 0.7 s so a thumb still held does not
restart the run before the time is read. Hiding the page (lock screen, a
notification, another tab) pauses the run and the music together; coming back
resumes through the same count-in. On phones the key hints are not shown. On
iOS 17 and later the game claims a playback audio session, so the ring/silent
switch does not mute it; on older iOS it does, and the title screen says so.

## Music

The music is synthesized in the browser with Tone.js and driven by game state.
The default register (v2, after the 2026-09-15 rehearsal) is built to be
hypnotic rather than anxious: 128 to 136 BPM, the range of Super Hexagon's own
tracks; a minor hexatonic scale with a real root; a kick-locked pump that dips
the bass, pad and arp on every beat; an off-beat bass between the kicks; and
layers that arrive on plateaus every few bars (pad and bass, then the arp in
8ths, then hats, then the arp at 16ths) with the arp's shape changing on a fixed
schedule instead of at random. The nearest wall in your lane lifts the
brightness a little, the sector you occupy becomes the arp's melody note,
threading a gap fires an accent, death sweeps the mix down, and a new best gets
a stinger. The visual pulse locks to the beat. The previous register (v1:
160 BPM, whole-tone, random degradation) is one chip away for comparison.

Every mapping has a knob. The values persist in local storage and can be set
from the URL as `?tune=reactivity=0.5,drums=false`. `reactivity=0` turns the
engine into a metronome, which is what Super Hexagon does. The visual pulse is
placed on the audible beat by shifting the Transport phase by the audio output
latency; `beatOffsetMs` adds a manual trim for Bluetooth output, where the
reported latency can be short of the real one. The tune sheet's first chip
rows are listening choices for the register (tempo, scale, arp ceiling, pump,
`register v1`), meant to be compared by ear with the A/B pair. For a guided
version of that, open `?tune=guide` on a phone (or tap "guide me" on the tune
sheet): it plays configurations in pairs, asks which you prefer, walks an
adaptive flowchart (old or new register, then tempo, scale, pulse, arp density,
reactivity, drums), and ends with your pick applied and a link to share.

## Tuning

`?tune` in the URL is the game master's door; without it none of this exists
and the surface stays field, time, best.

On a keyboard, `?tune` opens the side panel and T toggles it; every knob is
live while you play. On a phone, `?tune` adds a **tune** button to the title
and game-over screens that opens a full-screen sheet between runs:

- **Chips** are presets that stack: metronome, foreshadow, drone death, minor
  hex, no drums. Each is a diff from default, so the line under them is the
  configuration in force as a `?tune=` string (or `default`), and **copy
  link** gives you a URL that opens with the same configuration. A slider
  change shows up in the diff too; a chip is lit only while its keys still
  hold.
- **Ghost mode** runs the full game with walls passing through you, so every
  mapping keeps sounding while nothing can kill you: the way to hear what a
  knob does. On a phone a strip along the bottom edge turns one knob at a
  time mid-run (stop ends the run; on a keyboard, Escape). A ghost run sets
  no best and is not logged. Ghost is honoured only under `?tune`.
- **A / B** saves two configurations; the game-over screen then offers
  **again A** / **again B** so alternating takes seconds, and the HUD names
  the slot while you play.
- **Runs** logs every non-ghost death under `?tune` — time, configuration,
  slot, and the run stats — to local storage (newest 300) and shows them
  grouped by configuration with n, median and best. Copy as JSON or clear.

Patterns are written in a small Tidal-style mini-notation (`src/music/mini.ts`)
over a pure pattern core (`src/music/pattern.ts`) whose query model matches
Strudel's, so the sequencing can grow or be swapped later.

## The board

Each run is posted to a small backend and shown on a board meant for a
projector: https://edobry.github.io/flotato/board/ has a QR code for the play
URL, the top ten of the last twelve hours, a feed of what just happened, and
the room's numbers (runs, players, median reaction latency, median beat R,
death classes). The game-over screen shows your rank for the run. Identity is
a three-letter tag typed once on the start screen and kept in local storage,
plus an anonymous per-device id; nothing else leaves the phone. The `telemetry`
knob turns posting off; a dev server never posts unless opened with
`?tune=telemetry=true`.

The backend is a Cloudflare Worker with a D1 database under `worker/`:
`POST /run` stores one run summary (the same object the console line carries,
flattened into columns) and answers with the rank; `GET /board?limit=10&hours=12`
returns the top runs, the feed and the stats. Deploy with `npm run worker:deploy`,
apply schema changes with `npm run worker:migrate`, and clear the board before a
new session with `npm run worker:reset`. `npm run qr` regenerates `public/qr.svg`.

## The room

One field for a whole room: https://edobry.github.io/flotato/room/ on the
laptop that feeds the projector, https://edobry.github.io/flotato/pad/ on
every phone (the lobby shows the QR). A player types a name and gets a face:
the name is hashed, the hash seeds an elementary cellular automaton, sixteen
rows mirrored make the glyph (`src/glyph.ts`), so the pad and the projector
agree without sending pixels. Hold the phone sideways, like a gamepad (a portrait phone shows a rotate hint; Android
Chrome locks to landscape where it can). Ready up on the phone; the host starts the round
with Space (or the round starts itself a few seconds after everyone present is
ready). During play the phone is a controller, hold left or right, and the
projector is where you look; when you fall, the phone shows your time and
place, and you are in the next round. A round ends when the last player falls
or at the cap; the lobby returns with ready flags cleared.

The host page runs the whole game; the phones only send which way they hold.
A Durable Object in the Worker (`worker/src/room.ts`, `/room/<code>/ws`)
relays inputs to the host and the host's state to the pads; rooms are named
in the URL (`?room=<code>`, default `fractal`). Each death posts to the board
as a run with `variant: 'room'`, tagged with the first three letters of the
name, so the board and the D1 rows cover the room too.

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

## Install and offline

The game is a PWA: on a phone, "Add to Home Screen" gives a full-screen icon
that opens without browser chrome. A service worker (`vite-plugin-pwa`,
configured in `vite.config.ts`) precaches the single-player shell, its chunks
and the audio engine, so a run plays with no network from the second visit on.
The board, pad and room need the Worker and stay online-only. A new deploy
installs beside the running one and takes over at a moment that costs no run
(`src/update.ts`): right away on the title screen, otherwise when the page is
hidden between runs, otherwise on the next open. The manifest is
`public/manifest.webmanifest`; the icons come from `npm run icons`
(`rsvg-convert`) and are committed.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
npm run lint
npm run icons    # re-render public/icons/ from public/favicon.svg
```

The dev server runs without the service worker; `npm run preview` serves the
built site with it.

## Deploy

Every push to `main` builds and deploys to GitHub Pages through
`.github/workflows/deploy.yml`.
