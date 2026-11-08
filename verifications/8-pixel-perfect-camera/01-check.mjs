/** V1: the "done when" command passes, and the unit tests this ticket adds ran and passed. */
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
results.push(check('whole-number zoom tests passed', passedNamed(/^wholeZoomFor /) >= 4, `${passedNamed(/^wholeZoomFor /)} tests`));
results.push(check('device-pixel snapping tests passed', passedNamed(/^snapViewToDevicePixels /) >= 4, `${passedNamed(/^snapViewToDevicePixels /)} tests`));
results.push(check('the bigger level still passes the sim movement and determinism tests', passedNamed(/stopped by the east border wall/) === 1 && passedNamed(/determinism same seed/) === 1));
writeProof('01-check-output.txt', log);
writeProof('01-tests.json', report);
process.exit(summarize(results) ? 0 : 1);
