/** V1: the "done when" command passes, and the specific sim tests the ticket asks for ran and passed. */
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
results.push(check('headless N-tick movement test passed', passedNamed(/player movement \(headless\) moves at the def speed for N ticks/) === 1));
results.push(check('wall collision test passed', passedNamed(/stopped by the east border wall/) === 1));
results.push(check('determinism test passed', passedNamed(/determinism same seed \+ same commands = identical state/) === 1));
results.push(check('tests ran in all three packages', ['packages/sim/', 'packages/client/', 'packages/server/'].every((p) => tests.some((t) => t.file.includes(p)))));
writeProof('01-check-output.txt', log);
writeProof('01-tests.json', report);
process.exit(summarize(results) ? 0 : 1);
