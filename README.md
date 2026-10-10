# Poly Track (clone)

A browser recreation of **PolyTrack**, the low-poly time-trial racer by Kodub: drive
through loops, off jumps and over boosters against the clock, chase medal times and your own
ghost, and build and share your own tracks in the editor.

Built from scratch with [three.js](https://threejs.org/) and Vite. No assets: every model,
texture and sound is generated in code.

## What was recreated

PolyTrack is a TrackMania-style game. These are the parts of it this clone covers:

| PolyTrack feature | In this clone |
| --- | --- |
| Low-poly time trial on floating, grid-built tracks | Tracks are built from 10 m grid pieces with 2.5 m height steps, and elevated sections get support pillars automatically |
| Loops, jumps, slopes, high speed | Pieces: straight, sharp turn, wide turn, slope, long slope, ramp, loop (left or right), booster, platform |
| Checkpoints with split times and respawn | Checkpoints count in any order and all are needed to finish. Splits are compared to your PB. **Enter / R** respawns at the last checkpoint with the speed you had there |
| Quick restarts | **Backspace / T** restarts instantly. The clock starts on your first input |
| Medals | Author, Gold, Silver and Bronze times on every campaign track |
| Ghost of your best run | Recorded at 30 Hz and stored in `localStorage`. **G** toggles it |
| Summer / Winter / Desert environments | Three themes, each with its own sky, ground, scenery and mountains |
| Track editor with sharing | Place, rotate, flip, set height, erase, undo/redo, test drive, save, and export/import share codes or play links |
| Car customisation | Body and accent colours in Settings |
| Keyboard, gamepad, touch | All three are supported, with on-screen controls on touch devices |

The campaign has 8 tracks: Summer 1–3, Winter 1–2, Desert 1–2 and a Grand Tour finale.

## Running it

```bash
npm install
npm run dev      # start a dev server, then open the printed URL
npm run build    # static build in dist/ (relative paths, works on any static host / GitHub Pages)
npm run preview  # serve the build
npm test         # headless test-suite (Node 18+), see below
```

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ / Space | Brake / reverse |
| A D / ← → | Steer |
| Enter / R | Respawn at last checkpoint |
| Backspace / T | Restart |
| C | Camera (Chase / Close / Hood) |
| G | Toggle ghost |
| M | Mute |
| Esc / P | Pause |

Gamepad: RT/LT throttle and brake, left stick steers, A respawns, Y restarts, X changes camera.

### Editor

| Input | Action |
| --- | --- |
| Left click | Place piece |
| Right click / X (eraser) | Erase |
| Right drag | Orbit camera |
| Middle drag, WASD | Pan |
| Wheel | Zoom |
| Q / E, Shift + wheel | Build height down / up |
| R / Shift+R | Rotate |
| F | Flip (mirror), e.g. for the loop direction |
| 1 – 0 | Pick piece |
| Alt + click | Copy a placed piece's type and rotation |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S | Save to "My Tracks" |
| Enter | Test drive |

Share codes look like `PT1…`. They are deflate-compressed JSON (see `src/core/share.js`).
**Export → Copy play link** makes a URL that opens the track straight away.

## How it works

```
src/
  core/            engine with no DOM or WebGL, runs in Node as well as the browser
    pieces.js      piece catalogue: centreline paths swept into road geometry
    sweep.js       profile-extrusion mesh builder (road, kerbs, walls, caps)
    collision.js   triangle soup + 3D spatial hash; one-sided raycasts and sphere contacts
    physics.js     raycast-vehicle car: suspension rays, sequential-impulse tyre friction,
                   body spheres, downforce, boosters
    race.js        fixed 240 Hz race session: timer, checkpoints, respawn, finish
    track.js       compile a track (geometry, collision, triggers, spawn), plus a chain builder
    tracks.js      the campaign
    bot.js         autopilot (pure pursuit with grip-limited speed planning)
    share.js       track codes
  game/            browser layer: rendering, UI, input, audio, editor
  main.js          app shell and mode switching (menu / race / editor)
tests/run.js       headless test-suite
```

- **Physics.** The car is a unit-mass rigid body. Four suspension rays act as springs along the
  car's up axis. Tyre grip is solved as clamped velocity impulses (lateral and braking) limited by
  each wheel's load, so cornering is grippy until the limit and then slides. Wheels ignore wall
  surfaces, so the car can't climb kerbs. Walls are handled by spheres on the body. Downforce and
  load-dependent grip keep the car on the track through loops.
- **Determinism.** The simulation runs at a fixed 240 Hz with interpolated rendering. Times are
  exact multiples of 1/240 s.
- **Tests.** `npm test` checks the physics (settling, 0–100 time, top speed, braking), drives a
  small test track for every piece type, checks that missing checkpoints block the finish, and
  has the autopilot finish all 8 campaign tracks with zero respawns. It also round-trips every
  track through a share code. The author medal times come from these autopilot runs, so each one
  is proven to be achievable.

## Disclaimer

This is a fan-made recreation for learning and fun. It is not affiliated with Kodub or PolyTrack.
Play the original at [kodub.itch.io/polytrack](https://kodub.itch.io/polytrack).
