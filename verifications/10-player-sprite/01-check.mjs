/** V1: the "done when" commands pass, and the tests this ticket adds (Facing headless, pose picking) ran and passed. */
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
results.push(check('Facing: spawns facing down', passedNamed(/player facing \(headless\) spawns facing down/) === 1));
results.push(check('Facing: follows the move intent and persists after a stop', passedNamed(/player facing \(headless\) turns to face a non-zero move intent and keeps facing it after a stop/) === 1));
results.push(check('Facing: unit length, malformed input ignored, in the snapshot, reset on id reuse', passedNamed(/player facing \(headless\)/) >= 7, `${passedNamed(/player facing \(headless\)/)} facing tests`));
results.push(check('client pose picking tests passed', passedNamed(/poseFromHeading|directionFromVector/) >= 3));
results.push(check('determinism test still passes with the new component', passedNamed(/determinism same seed \+ same commands = identical state/) === 1));
results.push(check('existing movement and snapshot tests still pass', passedNamed(/player movement \(headless\)/) >= 9 && passedNamed(/^snapshot /) >= 3));
writeProof('01-check-output.txt', log);
writeProof('01-tests.json', report);
process.exit(summarize(results) ? 0 : 1);
