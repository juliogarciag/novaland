/** V1: the "done when" commands pass, and the tests this ticket adds (avatars, spread spawns, pass-through, seats) ran and passed. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, check, run, summarize, writeProof } from './lib.mjs';

const results = [];
let log = '';
const steps = [
  ['install', ['install', '--frozen-lockfile']],
  ['test', ['exec', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${path.join(PROOF, '01-tests.json')}`]],
  ['typecheck', ['typecheck']],
  ['lint', ['lint']],
];
for (const [name, args] of steps) {
  const { code, output } = await run('pnpm', args);
  log += `\n$ pnpm ${args.join(' ')}\n${output}\n(exit ${code})\n`;
  results.push(check(`pnpm ${name} exits 0`, code === 0, `exit ${code}`));
}

const report = JSON.parse(readFileSync(path.join(PROOF, '01-tests.json'), 'utf8'));
const tests = report.testResults.flatMap((file) => file.assertionResults.map((t) => ({ file: file.name, name: t.fullName, status: t.status })));
const passedNamed = (pattern) => tests.filter((t) => pattern.test(t.name) && t.status === 'passed').length;
results.push(check('all tests passed, none skipped', report.numFailedTests === 0 && report.numPendingTests === 0 && report.numPassedTests === report.numTotalTests, `${report.numPassedTests}/${report.numTotalTests}`));
results.push(check('avatars: deterministic per seed, other seeds differ', passedNamed(/avatars on join \(headless\) picks the same avatars for the same seed/) === 1));
results.push(check('avatars: no duplicates while an unworn one is left, fallback once all are worn, freed on leave', passedNamed(/avatars on join \(headless\) (never hands out|falls back|frees an avatar)/) === 3));
results.push(check('avatars: a join carrying an avatar is ignored, the sim chooses', passedNamed(/avatars on join \(headless\) ignores any avatar a client puts/) === 1));
results.push(check('spawns: five joins on five distinct walkable tiles next to the spawn, spread on both axes', passedNamed(/spread spawns \(headless\) (lands five joins|spreads players around)/) === 2));
results.push(check('spawns: taken and solid tiles skipped, freed tiles reused, no free tile never throws', passedNamed(/spread spawns \(headless\) (skips solid|treats a tile|falls back)/) === 3));
results.push(check('pass-through: two players cross at full speed; a standing player blocks nobody; terrain still stops', passedNamed(/players pass through each other \(headless\)/) === 3));
results.push(check('client seats: queued joins never pick the same seat twice in one frame', passedNamed(/^seats /) === 3));
results.push(check('determinism test still passes', passedNamed(/determinism same seed \+ same commands = identical state/) === 1));
results.push(check('existing movement, facing, terrain and server tests still pass', passedNamed(/player movement \(headless\)/) >= 9 && passedNamed(/player facing \(headless\)/) >= 7 && passedNamed(/terrain feature \(headless\)/) >= 5 && passedNamed(/server headless run/) >= 3));
writeProof('01-check-output.txt', log);
writeProof('01-tests.json', report);
process.exit(summarize(results) ? 0 : 1);
