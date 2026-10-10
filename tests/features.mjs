import { TrackChain } from '../src/core/track.js';
import { runBot } from './botrun.mjs';
const tracks = {
  turns: new TrackChain('turns').start().straight(3).right().straight(2).left().straight(2).wideRight().straight(2).wideLeft().straight(3).finish().build(),
  slopes: new TrackChain('slopes').start().straight(3).up().straight(2).up().straight(2).down().straight(1).down().straight(3).finish().build(),
  loop: new TrackChain('loop').start().straight(4).loop().straight(4).finish().build(),
  boostloop: new TrackChain('boostloop').start().straight(2).boost(2).straight(2).loop().straight(4).finish().build(),
  jump: new TrackChain('jump').start().straight(6).ramp().gap(4).platform(4).straight(3).finish().build(),
  cps: new TrackChain('cps').start().straight(2).cp().straight(2).right().cp().straight(3).finish().build(),
};
for (const [k, t] of Object.entries(tracks)) {
  const r = runBot(t, { verbose: true, maxTime: 60 });
  console.log(k, r.finished ? 'FINISHED' : 'FAILED', r.time.toFixed(3), 'respawns', r.respawns, 'progress', r.progress.toFixed(2), 'cps', r.cps + '/' + r.totalCps);
  if (r.log.length) console.log('   ' + r.log.slice(0, 12).join('\n   '));
}
