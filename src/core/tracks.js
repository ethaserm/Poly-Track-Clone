import { TrackChain } from './track.js';

/**
 * Built-in campaign. Each track is authored as a chain of connected pieces.
 * Medal times are derived from the autopilot (see tests/run.js --medals) and then
 * hand-tuned: author ≈ a clean bot run, gold/silver/bronze progressively easier.
 */
function medals(author) {
  const r = (v) => Math.ceil(v * 100) / 100;
  return { author: r(author), gold: r(author * 1.06), silver: r(author * 1.18), bronze: r(author * 1.35) };
}

export const TRACK_DEFS = [
  {
    id: 'summer-1',
    build: () =>
      new TrackChain('Summer 1 · First Lap', 'summer')
        .start()
        .straight(4)
        .right()
        .straight(3)
        .cp()
        .straight(2)
        .wideLeft()
        .straight(3)
        .left()
        .straight(2)
        .cp()
        .straight(2)
        .wideRight()
        .straight(4)
        .finish(),
  },
  {
    id: 'summer-2',
    build: () =>
      new TrackChain('Summer 2 · Hilltop', 'summer')
        .start()
        .straight(3)
        .up()
        .straight(2)
        .right()
        .up()
        .straight(1)
        .cp()
        .straight(2)
        .wideLeft()
        .straight(2)
        .down()
        .straight(1)
        .left()
        .straight(2)
        .down()
        .cp()
        .straight(2)
        .right()
        .straight(3)
        .finish(),
  },
  {
    id: 'summer-3',
    build: () =>
      new TrackChain('Summer 3 · Loop Day', 'summer')
        .start()
        .straight(2)
        .boost()
        .straight(2)
        .loop()
        .straight(2)
        .cp()
        .straight(1)
        .wideRight()
        .straight(3)
        .ramp()
        .gap(4)
        .platform(3)
        .straight(1)
        .cp()
        .wideRight()
        .boost()
        .straight(2)
        .loop(true)
        .straight(3)
        .finish(),
  },
  {
    id: 'winter-1',
    build: () =>
      new TrackChain('Winter 1 · Frozen Lake', 'winter')
        .start()
        .straight(3)
        .ramp()
        .gap(4)
        .platform(2)
        .straight(2)
        .wideLeft()
        .straight(2)
        .cp()
        .straight(1)
        .wideLeft()
        .straight(1)
        .boost()
        .straight(2)
        .ramp()
        .gap(5)
        .platform(3)
        .cp()
        .straight(1)
        .right()
        .straight(1)
        .left()
        .straight(4)
        .finish(),
  },
  {
    id: 'winter-2',
    build: () =>
      new TrackChain('Winter 2 · Avalanche', 'winter', { x: 0, y: 12, z: 0, d: 0 })
        .start()
        .straight(1)
        .longDown()
        .straight(1)
        .cp()
        .wideRight()
        .straight(1)
        .down()
        .straight(1)
        .wideLeft()
        .boost()
        .straight(1)
        .longDown()
        .cp()
        .straight(2)
        .right()
        .straight(1)
        .down()
        .straight(2)
        .ramp()
        .gap(5, -2)
        .platform(3)
        .straight(1)
        .finish(),
  },
  {
    id: 'desert-1',
    build: () =>
      new TrackChain('Desert 1 · Dune Runner', 'desert')
        .start()
        .straight(1)
        .boost(2)
        .straight(3)
        .wideRight()
        .straight(2)
        .boost()
        .ramp()
        .gap(4)
        .platform(3)
        .straight(2)
        .cp()
        .wideLeft()
        .straight(1)
        .up()
        .straight(3)
        .wideLeft()
        .straight(2)
        .cp()
        .boost()
        .straight(1)
        .ramp()
        .gap(4, -2)
        .platform(3)
        .straight(2)
        .right()
        .straight(4)
        .finish(),
  },
  {
    id: 'desert-2',
    build: () =>
      new TrackChain('Desert 2 · Mirage', 'desert')
        .start()
        .straight(2)
        .boost()
        .loop()
        .straight(2)
        .cp()
        .wideRight()
        .straight(1)
        .boost()
        .ramp()
        .gap(4)
        .platform(3)
        .straight(2)
        .right()
        .up()
        .straight(2)
        .cp()
        .wideLeft()
        .down()
        .straight(2)
        .left()
        .boost()
        .straight(1)
        .loop(true)
        .straight(1)
        .cp()
        .wideLeft()
        .straight(5)
        .finish(),
  },
  {
    id: 'grand-tour',
    build: () =>
      new TrackChain('Finale · Grand Tour', 'summer')
        .start()
        .straight(2)
        .boost()
        .straight(1)
        .longUp()
        .straight(2)
        .cp()
        .wideRight()
        .straight(1)
        .boost()
        .ramp()
        .gap(4, -2)
        .platform(3)
        .straight(4)
        .right()
        .straight(1)
        .down()
        .straight(1)
        .cp()
        .boost()
        .loop()
        .straight(2)
        .wideLeft()
        .straight(2)
        .left()
        .cp()
        .straight(1)
        .up()
        .straight(3)
        .wideRight()
        .straight(1)
        .boost()
        .ramp()
        .gap(4, -2)
        .platform(3)
        .straight(1)
        .cp()
        .wideRight()
        .straight(4)
        .finish(),
  },
];

// Medal times (seconds). Filled in from autopilot runs; see tests/run.js.
const MEDALS = {
  'summer-1': 14.15,
  'summer-2': 15.4,
  'summer-3': 17.65,
  'winter-1': 17.3,
  'winter-2': 17.4,
  'desert-1': 19.5,
  'desert-2': 24.05,
  'grand-tour': 28.25,
};

export const BUILTIN_TRACKS = TRACK_DEFS.map((d) => {
  const track = d.build().build();
  return { ...track, id: d.id, builtin: true, medals: medals(MEDALS[d.id]) };
});

export function getBuiltinTrack(id) {
  return BUILTIN_TRACKS.find((t) => t.id === id);
}
