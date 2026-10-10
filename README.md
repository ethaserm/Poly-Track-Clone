# Poly Track (clone)

A browser recreation of **PolyTrack**, the low-poly time-trial racer by Kodub: drive
through loops, wall rides, jumps and boosters against the clock, chase medal times and your own
ghost, watch replays, and build and share your own tracks in the editor.

Built from scratch with [three.js](https://threejs.org/) and Vite. No assets: every model,
texture, sound and music note is generated in code.

## Features

### Driving
- Arcade raycast-vehicle physics at a fixed 240 Hz: suspension, grip-limited tyres, drifting,
  downforce, loops, wall rides, airtime and landings.
- Surfaces: tarmac, **booster pads**, **ice** (almost no grip), **dirt** (loose), off-road
  grass/snow/sand, and **water** in lakes (very slow).
- Checkpoints count in any order. **Enter / R** respawns at the last checkpoint with the speed
  you had there, and **Backspace / T** restarts instantly. The clock starts on your first input.
- Three cameras (chase, close, hood). The camera rolls with the car through loops. There is
  also camera shake on landings and impacts, plus speed blur and speed streaks.

### Content
- **21 track pieces**: start, finish, checkpoint, straight, tight turn, wide turn, banked turn,
  3×3 wall ride, chicane, slope, short slope, long slope, bumps, booster, ramp, loop, platform,
  tunnel, block, ice and dirt.
- **16 campaign tracks** across Summer, Winter and Desert, plus two finales. Each has Author,
  Gold, Silver and Bronze medal times. The autopilot finishes every track in the test-suite, and
  its time is the author time, so every medal is achievable.

### Presentation
- Detailed low-poly car: lofted body with wheel arches, two-tone liveries and a racing stripe,
  a visible driver, splitter, diffuser, rear wing, mirrors and race numbers. It has working
  head, brake and reverse lights, exhaust flames, spoked rims, brake discs and calipers, and
  body roll.
- Tracks have textured asphalt and dashed centre lines. Gates are lattice towers with start
  lights, LED strips, glowing timing lines and waving flags. There are animated booster pads,
  ramp hazard stripes, corner marker boards, street lamps and support pillars.
- Worlds: terrain with rolling hills or mountains, lakes and frozen ponds, and forest groves.
  Scenery includes 20+ instanced plant, rock and prop types, windmills, barns, cottages, log cabins
  with chimney smoke, igloos, rock arches and oasis palms. Around the start line there is a
  grandstand with an animated crowd that cheers at the finish, pit tents, billboards and tyre
  walls. Overhead there are hot-air balloons, bird flocks and tumbleweeds, with snowfall in
  winter and a sun glow.
- Effects: tyre smoke, off-road dust, skid marks and ruts, wall sparks, boost afterburn,
  landing puffs, checkpoint and respawn bursts, finish confetti and screen pulses.
- Rendering: Low/Medium/High/Ultra presets, bloom, neutral tone mapping, colour grading,
  vignette, shadows and environment reflections. A typical race frame draws about 200 calls
  and 225k triangles.

### Game systems
- HUD: timer, live gap to your personal-best ghost, checkpoint splits and progress bar, an
  analog speedometer with gear and RPM, a minimap, medal targets and a respawn counter.
- Finish screen: sector table compared with your PB, top speed, rank, and your local top-5.
- **Replays**: watch your last run or your PB with TV-style trackside cameras, chase, orbit
  and overhead cams. You can pause, scrub and play at 0.25×–2× speed.
- **Ghosts** of your best run, **leaderboards** (your 10 fastest runs per track) and a
  **stats** page (distance, drive time, finish rate, top speed, air time, medals and more).
- **Garage**: body, accent and rim colours (presets or any colour), four liveries and a race
  number, all on a 3D turntable.
- Audio: a layered synthesised engine with gear shifts, turbo whistle and backfire pops, tyre
  squeal or gravel crunch depending on the surface, wind, wall scrapes, boost whoosh, landing
  thumps, and a generative synthwave soundtrack with separate music and effects volumes.
- Keyboard, gamepad and touch (on-screen controls on phones).

### Track editor
- Palette with category tabs and rendered thumbnails. You can place, rotate, flip, change
  height, erase, undo and redo.
- **Box select** with copy, cut, paste (rotatable stamps), delete and select-all.
- Top view, a track info panel with length, height and validation hints, and a draft
  autosave.
- Test drive, save to My Tracks, and export/import share codes or play links.

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
Replays: Space play/pause, ←/→ seek, [ / ] speed, C camera.

### Editor

| Input | Action |
| --- | --- |
| Left click | Place piece (or paste stamp) |
| Right click / X (eraser) | Erase |
| Right drag | Orbit camera |
| Middle drag, WASD | Pan |
| Wheel | Zoom |
| Q / E, Shift + wheel | Build height down / up |
| R / Shift+R | Rotate piece or stamp |
| F | Flip (mirror), e.g. for the loop direction |
| 1 – 0, Tab | Pick piece, next category |
| B | Box select (drag; Shift adds) |
| Ctrl+A / C / X / V | Select all / copy / cut / paste |
| Delete | Delete selection or the piece under the cursor |
| Alt + click | Copy a placed piece's type and rotation |
| V, I | Top view, track info |
| Ctrl+Z / Ctrl+Y, Ctrl+S | Undo / redo, save |
| Enter | Test drive |

Share codes look like `PT1…`. They are deflate-compressed JSON (see `src/core/share.js`). New
pieces are appended to the type list, so old codes still load.

## How it works

```
src/
  core/              engine with no DOM or WebGL, runs in Node as well as the browser
    pieces.js        piece catalogue: centreline paths (with banking) swept into road geometry
    sweep.js         profile-extrusion mesh builder with UVs, dashes and oriented boxes
    collision.js     triangle soup + 3D spatial hash; raycasts, sphere contacts, terrain ground
    terrain.js       deterministic hills, lakes and frozen ponds shared by renderer and physics
    physics.js       raycast-vehicle car, surfaces, scrape/landing tracking
    race.js          fixed 240 Hz race session: timer, checkpoints, respawn, finish
    track.js         compile a track (geometry, collision, triggers, lamps, pads), chain builder
    tracks.js        the campaign
    bot.js           surface-aware autopilot (pure pursuit with grip-limited speed planning)
    share.js         track codes
  game/              browser layer
    renderer.js      quality presets, post-processing, environment maps
    trackScene.js    shared scene setup for races, replays and the menu demo
    raceMode.js      racing, HUD wiring, ghosts, stats, finish screen
    replayMode.js    replay viewer and broadcast cameras
    editorMode.js    track editor
    garageMode.js    car customisation
    menuMode.js      menus, campaign, leaderboards, stats, settings
    carModel.js      lofted car model
    environment.js   sky, terrain, water, scenery placement, ambient life
    props.js         procedural scenery, landmark and trackside geometry
    trackView.js     road mesh, gates, booster pads, lamps, pillars
    effects.js       particle effects, skid marks, speed lines
    particles.js     GPU point particles and skid-mark ribbons
    hud.js           HUD, speedometer, minimap
    audio.js         synthesised sound effects and generative music
  main.js            app shell and mode switching
tests/run.js         headless test-suite
```

- **Physics.** The car is a unit-mass rigid body. Four suspension rays act as springs along the
  car's up axis. Tyre grip is solved as clamped velocity impulses limited by wheel load and
  surface grip. Wheels ignore wall surfaces, so the car can't climb kerbs. Walls and the ground
  are handled by spheres on the body. The ground is the same terrain function the renderer
  uses.
- **Determinism.** The simulation runs at a fixed 240 Hz with interpolated rendering. Ghosts and
  replays record position, rotation, steering, speed and light state at 30 Hz.
- **Tests.** `npm test` checks the physics (settling, 0–100 time, top speed, braking) and drives
  a test track for every piece type (turns, banks, wall rides, chicanes, slopes, bumps, loops,
  ramps, ice, dirt, tunnels, blocks). It checks that missing checkpoints block the finish, has
  the autopilot finish all 16 campaign tracks with zero respawns, and round-trips every track
  through a share code.

## Disclaimer

This is a fan-made recreation for learning and fun. It is not affiliated with Kodub or PolyTrack.
Play the original at [kodub.itch.io/polytrack](https://kodub.itch.io/polytrack).
