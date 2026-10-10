import { compileTrack } from '../src/core/track.js';
import { RaceSim } from '../src/core/race.js';
import { Bot } from '../src/core/bot.js';
import { PHYSICS_HZ } from '../src/core/constants.js';

export function runBot(track, { maxTime = 180, verbose = false, opts = {} } = {}) {
  const c = compileTrack(track);
  const sim = new RaceSim(c);
  const bot = new Bot(c.driveLine, opts);
  let lastProgressS = 0, lastProgressTick = 0, worstOff = 0, log = [];
  for (let i = 0; i < PHYSICS_HZ * maxTime; i++) {
    const input = bot.drive(sim.car);
    worstOff = Math.max(worstOff, bot.offLine);
    const ev = sim.tick(input);
    for (const e of ev) if (verbose) log.push(`${(sim.time).toFixed(2)} ${e.type} ${e.id ?? ''}`);
    if (sim.finished) break;
    const s = bot.s[bot.idx];
    if (s > lastProgressS + 2) { lastProgressS = s; lastProgressTick = i; }
    const stuck = i - lastProgressTick > PHYSICS_HZ * 4;
    const off = bot.offLine > 9 && sim.car.grounded > 0;
    if (stuck || off) {
      if (verbose) log.push(`${sim.time.toFixed(2)} RESPAWN (${stuck ? 'stuck' : 'off'}) at s=${s.toFixed(1)} pos=${sim.car.pos.toArray().map(v=>v.toFixed(1))}`);
      sim.respawn();
      bot.relocate(sim.car.pos);
      lastProgressTick = i; lastProgressS = bot.s[bot.idx];
      if (sim.respawns > 15) break;
    }
  }
  return { finished: sim.finished, time: sim.time, respawns: sim.respawns, log, length: bot.s[bot.s.length-1], progress: bot.progress, cps: sim.collected.size, totalCps: c.checkpointCount };
}
