// Headless test-suite: builds every built-in track, checks it for overlapping pieces,
// and lets the autopilot drive it to prove it can be finished.
// Usage: node tests/run.js [--medals] [--verbose]
import { runBot } from './botrun.mjs';

const args = new Set(process.argv.slice(2));
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

let tracksModule;
try {
  tracksModule = await import('../src/core/tracks.js');
} catch (e) {
  check('built-in tracks build without overlaps', false, e.message);
  process.exit(1);
}
const { BUILTIN_TRACKS } = tracksModule;
check('built-in tracks build without overlaps', true, `${BUILTIN_TRACKS.length} tracks`);

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
    check(`  author medal of ${track.id} is beatable by the bot`, r.time <= track.medals.author + 0.5, `bot ${r.time.toFixed(2)} vs author ${track.medals.author}`);
  }
}

// Unit checks for the geometry/codec helpers.
const { compileTrack } = await import('../src/core/track.js');
const { encodeTrack, decodeTrack } = await import('../src/core/share.js');
for (const track of BUILTIN_TRACKS) {
  const compiled = compileTrack(track);
  check(`${track.id} has a spawn and a finish`, !!compiled.spawn && compiled.finishCount > 0);
  const code = await encodeTrack(track);
  const back = await decodeTrack(code);
  const same = JSON.stringify(back.pieces) === JSON.stringify(track.pieces.map(({ t, x, y, z, r, m }) => ({ t, x, y, z, r, m: m ? 1 : 0 })));
  check(`${track.id} survives export/import`, same && back.name === track.name && back.env === track.env, `${code.length} chars`);
}

if (args.has('--medals')) {
  console.log('\nSuggested MEDALS table:');
  for (const [id, t] of Object.entries(medalTimes)) console.log(`  '${id}': ${(Math.ceil(t * 20) / 20).toFixed(2)},`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
