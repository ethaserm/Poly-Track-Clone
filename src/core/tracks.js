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
  {
    id: 'summer-4',
    build: () =>
      new TrackChain('Summer 4 · Riverside', 'summer')
        .start()
        .straight(2)
        .chicaneLeft()
        .straight(2)
        .bankRight()
        .straight(2)
        .cp()
        .bumps()
        .straight(1)
        .bankLeft()
        .straight(2)
        .chicaneRight()
        .straight(1)
        .cp()
        .wideRight()
        .boost()
        .straight(2)
        .finish(),
  },
  {
    id: 'summer-5',
    build: () =>
      new TrackChain('Summer 5 · Big Air', 'summer')
        .start()
        .straight(2)
        .boost()
        .straight(1)
        .ramp()
        .gap(4)
        .platform(3)
        .straight(2)
        .cp()
        .wallLeft()
        .straight(2)
        .boost()
        .loop()
        .straight(2)
        .cp()
        .bankRight()
        .straight(1)
        .boost()
        .ramp()
        .gap(4)
        .platform(3)
        .straight(2)
        .finish(),
  },
  {
    id: 'winter-3',
    build: () =>
      new TrackChain('Winter 3 · Black Ice', 'winter')
        .start()
        .straight(2)
        .ice(3)
        .straight(1)
        .wideRight()
        .straight(1)
        .cp()
        .ice(2)
        .straight(1)
        .bankLeft()
        .straight(1)
        .ice(2)
        .straight(2)
        .cp()
        .right()
        .straight(1)
        .ice(2)
        .straight(2)
        .finish(),
  },
  {
    id: 'winter-4',
    build: () =>
      new TrackChain('Winter 4 · Glacier Run', 'winter')
        .start()
        .straight(1)
        .tunnel(3)
        .straight(1)
        .up()
        .straight(2)
        .cp()
        .wallRight()
        .straight(1)
        .down()
        .straight(1)
        .tunnel(2)
        .straight(1)
        .cp()
        .bankLeft()
        .straight(2)
        .ice(2)
        .straight(1)
        .bumps()
        .straight(2)
        .finish(),
  },
  {
    id: 'desert-3',
    build: () =>
      new TrackChain('Desert 3 · Rally Raid', 'desert')
        .start()
        .straight(1)
        .dirt(3)
        .chicaneRight()
        .dirt(2)
        .bumps()
        .cp()
        .wideLeft()
        .dirt(2)
        .bumps()
        .straight(1)
        .cp()
        .bankRight()
        .dirt(2)
        .chicaneLeft()
        .dirt(2)
        .finish(),
  },
  {
    id: 'desert-4',
    build: () =>
      new TrackChain('Desert 4 · Canyon Wall', 'desert')
        .start()
        .straight(2)
        .boost()
        .straight(1)
        .wallLeft()
        .straight(1)
        .boost()
        .ramp()
        .gap(4)
        .platform(3)
        .straight(1)
        .cp()
        .wallLeft()
        .straight(2)
        .upShort()
        .straight(2)
        .cp()
        .bankRight()
        .downShort()
        .boost()
        .straight(3)
        .finish(),
  },
  {
    id: 'summer-6',
    build: () =>
      new TrackChain('Summer 6 · Concrete Jungle', 'summer')
        .start()
        .straight(1)
        .tunnel(2)
        .block(2)
        .straight(1)
        .cp()
        .right()
        .tunnel(2)
        .chicaneLeft()
        .straight(1)
        .upShort()
        .block(2)
        .downShort()
        .straight(1)
        .cp()
        .left()
        .straight(1)
        .boost()
        .tunnel(2)
        .straight(2)
        .finish(),
  },
  {
    id: 'grand-prix',
    build: () =>
      new TrackChain('Finale · Grand Prix', 'desert')
        .start()
        .straight(2)
        .boost()
        .straight(1)
        .loop()
        .straight(1)
        .cp()
        .wallRight()
        .straight(1)
        .chicaneLeft()
        .dirt(2)
        .cp()
        .bankLeft()
        .ice(2)
        .straight(1)
        .bumps()
        .cp()
        .right()
        .straight(1)
        .boost()
        .ramp()
        .gap(4)
        .platform(3)
        .straight(1)
        .cp()
        .wideRight()
        .tunnel(2)
        .boost()
        .loop(true)
        .straight(3)
        .finish(),
  },
];

// Medal times (seconds). Filled in from autopilot runs; see tests/run.js.
const MEDALS = {
  'summer-1': 14.25,
  'summer-2': 15.5,
  'summer-3': 17.7,
  'summer-4': 14.9,
  'summer-5': 16.85,
  'summer-6': 12.95,
  'winter-1': 17.4,
  'winter-2': 17.45,
  'winter-3': 13.7,
  'winter-4': 13.6,
  'desert-1': 19.95,
  'desert-2': 24.2,
  'desert-3': 14.75,
  'desert-4': 15.2,
  'grand-tour': 28.4,
  'grand-prix': 24.5,
};

const ORDER = [
  'summer-1', 'summer-2', 'summer-3', 'summer-4', 'summer-5', 'summer-6',
  'winter-1', 'winter-2', 'winter-3', 'winter-4',
  'desert-1', 'desert-2', 'desert-3', 'desert-4',
  'grand-tour', 'grand-prix',
];

export const BUILTIN_TRACKS = ORDER.map((id) => {
  const d = TRACK_DEFS.find((t) => t.id === id);
  const track = d.build().build();
  return { ...track, id: d.id, builtin: true, medals: medals(MEDALS[d.id]) };
});

export function getBuiltinTrack(id) {
  return BUILTIN_TRACKS.find((t) => t.id === id);
}
