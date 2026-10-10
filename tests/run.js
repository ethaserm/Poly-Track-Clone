// Headless test-suite (no browser needed): `npm test`
//   - physics sanity (settling, acceleration, top speed, braking)
//   - every piece type is drivable (autopilot runs small feature tracks)
//   - every built-in track builds without overlaps and can be finished
//   - track share codes round-trip
// Flags: --medals  print suggested medal times    --verbose  print race event logs
import { PHYSICS_HZ } from '../src/core/constants.js';
import { RaceSim } from '../src/core/race.js';
import { TrackChain, compileTrack } from '../src/core/track.js';
import { runBot } from './botrun.mjs';

const args = new Set(process.argv.slice(2));
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

// --- Physics sanity ----------------------------------------------------------------
{
  const sim = new RaceSim(compileTrack(new TrackChain('flat').start().straight(120).finish().build()));
  const car = sim.car;
  for (let i = 0; i < PHYSICS_HZ; i++) sim.tick({ throttle: 0, brake: 0, steer: 0 });
  const drift = Math.hypot(car.pos.x - sim.spawnPos.x, car.pos.z - sim.spawnPos.z);
  check('car settles on the road without drifting', car.grounded === 4 && drift < 0.05 && car.speed < 0.05, `drift ${drift.toFixed(3)}m`);
  let t100 = null;
  for (let i = 0; i < PHYSICS_HZ * 12; i++) {
    sim.tick({ throttle: 1, brake: 0, steer: 0 });
    if (t100 == null && car.speed * 3.6 >= 100) t100 = sim.time;
  }
  check('0-100 km/h between 1.5 and 3.5 s', t100 > 1.5 && t100 < 3.5, `${t100?.toFixed(2)}s`);
  const top = car.speed * 3.6;
  check('top speed on flat road 180-260 km/h', top > 180 && top < 260, `${top.toFixed(0)} km/h`);
  check('car stays upright and straight at speed', car.up.y > 0.99 && Math.abs(car.pos.x) < 0.2);
  const v0 = car.speed;
  let ticks = 0;
  while (car.forwardSpeed > 1 && ticks < PHYSICS_HZ * 10) {
    sim.tick({ throttle: 0, brake: 1, steer: 0 });
    ticks++;
  }
  const decel = v0 / (ticks / PHYSICS_HZ);
  check('brakes stop the car (average 20-45 m/s²)', decel > 20 && decel < 45, `${decel.toFixed(1)} m/s²`);
}

// --- Every piece type is drivable -------------------------------------------------
const features = {
  'turns (sharp + wide, both directions)': new TrackChain('turns').start().straight(3).right().straight(2).left().straight(2).wideRight().straight(2).wideLeft().straight(3).finish(),
  'slopes up and down': new TrackChain('slopes').start().straight(3).up().straight(2).longUp().straight(3).down().straight(2).longDown().straight(3).finish(),
  'loop': new TrackChain('loop').start().straight(4).loop().straight(4).finish(),
  'mirrored loop after booster': new TrackChain('boostloop').start().straight(2).boost(2).straight(2).loop(true).straight(4).finish(),
  'ramp jump onto platforms': new TrackChain('jump').start().straight(6).ramp().gap(4).platform(4).straight(3).finish(),
  'checkpoints in sequence': new TrackChain('cps').start().straight(2).cp().straight(2).right().cp().straight(3).finish(),
  'banked turns': new TrackChain('bank').start().straight(3).bankLeft().straight(2).bankRight().straight(3).finish(),
  'wall rides': new TrackChain('wall').start().straight(2).boost(2).straight(1).wallLeft().straight(2).boost().wallRight().straight(3).finish(),
  'chicanes': new TrackChain('chicane').start().straight(3).chicaneLeft().straight(1).chicaneRight().straight(3).finish(),
  'bumps': new TrackChain('bumps').start().straight(3).bumps().straight(1).bumps().straight(3).finish(),
  'short slopes': new TrackChain('short').start().straight(2).upShort().straight(2).upShort().straight(2).downShort().straight(2).downShort().straight(2).finish(),
  'ice': new TrackChain('ice').start().straight(2).ice(4).right().ice(2).straight(2).finish(),
  'dirt': new TrackChain('dirt').start().straight(2).dirt(4).wideLeft().dirt(2).straight(2).finish(),
  'tunnels': new TrackChain('tunnel').start().straight(2).tunnel(3).straight(2).finish(),
  'blocks': new TrackChain('block').start().straight(2).block(3).straight(2).finish(),
};
for (const [name, chain] of Object.entries(features)) {
  const r = runBot(chain.build(), { maxTime: 60 });
  check(`feature: ${name}`, r.finished && r.respawns === 0, `time ${r.time.toFixed(2)}s respawns ${r.respawns}`);
}

// --- Missing checkpoints block the finish ------------------------------------------
{
  // Drive straight through a finish while a checkpoint sits on a side branch.
  const chain = new TrackChain('skip').start().straight(3).finish().straight(1);
  chain.cur = { x: 3, y: 0, z: 0, d: 0 };
  chain.cp();
  const sim = new RaceSim(compileTrack(chain.build()));
  const events = [];
  for (let i = 0; i < PHYSICS_HZ * 6; i++) events.push(...sim.tick({ throttle: 1, brake: 0, steer: 0 }));
  check('finish does not count until all checkpoints are collected', !sim.finished && events.some((e) => e.type === 'missing'));
}

// --- Campaign -------------------------------------------------------------------------
let tracksModule;
try {
  tracksModule = await import('../src/core/tracks.js');
  check('built-in tracks build without overlaps', true, `${tracksModule.BUILTIN_TRACKS.length} tracks`);
} catch (e) {
  check('built-in tracks build without overlaps', false, e.message);
  process.exit(1);
}
const { BUILTIN_TRACKS } = tracksModule;

const medalTimes = {};
for (const track of BUILTIN_TRACKS) {
  const r = runBot(track, { maxTime: 240, verbose: args.has('--verbose') });
  const ok = r.finished && r.respawns === 0;
  medalTimes[track.id] = r.time;
  check(
    `autopilot finishes ${track.name}`,
    ok,
    `time ${r.time.toFixed(3)}s  respawns ${r.respawns}  checkpoints ${r.cps}/${r.totalCps}  length ${r.length.toFixed(0)}m`,
  );
  if (!ok || args.has('--verbose')) console.log('      ' + r.log.join('\n      '));
  if (track.medals && r.finished) {
    check(`  author medal of ${track.id} is achievable`, r.time <= track.medals.author + 0.5, `bot ${r.time.toFixed(2)} vs author ${track.medals.author}`);
  }
}

// --- Share codes ------------------------------------------------------------------------
const { encodeTrack, decodeTrack } = await import('../src/core/share.js');
for (const track of BUILTIN_TRACKS) {
  const compiled = compileTrack(track);
  check(`${track.id} has a spawn and a finish`, !!compiled.spawn && compiled.finishCount > 0);
  const code = await encodeTrack(track);
  const back = await decodeTrack(code);
  const strip = (pieces) => JSON.stringify(pieces.map(({ t, x, y, z, r, m }) => ({ t, x, y, z, r, m: m ? 1 : 0 })));
  check(`${track.id} survives export/import`, strip(back.pieces) === strip(track.pieces) && back.name === track.name && back.env === track.env, `${code.length} chars`);
}
let rejected = false;
try {
  await decodeTrack('hello');
} catch {
  rejected = true;
}
check('garbage track codes are rejected', rejected);

if (args.has('--medals')) {
  console.log('\nSuggested MEDALS table:');
  for (const [id, t] of Object.entries(medalTimes)) console.log(`  '${id}': ${(Math.ceil(t * 20) / 20).toFixed(2)},`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
