/**
 * V1: the "done when" commands pass, the tests this ticket adds ran and
 * passed, and the sim is untouched: a tree is still one solid tile and the
 * headless run ends on the same state hash as before the ticket.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, check, run, summarize, writeProof } from './lib.mjs';

/** What `pnpm sim:headless` printed on main before this ticket (also in verifications/19-one-process/proof/01-check-output.txt). */
const STATE_HASH_BEFORE_THE_TICKET = '50b21d74';

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
const tests = report.testResults.flatMap((file) => file.assertionResults.map((test) => ({ name: test.fullName, status: test.status })));
const passedNamed = (pattern) => tests.filter((test) => pattern.test(test.name) && test.status === 'passed').length;
results.push(check('all tests passed, none skipped', report.numFailedTests === 0 && report.numPendingTests === 0 && report.numPassedTests === report.numTotalTests, `${report.numPassedTests}/${report.numTotalTests}`));
results.push(check('client: standing tile placement tests passed', passedNamed(/standingTilePlacements/) === 5, `${passedNamed(/standingTilePlacements/)} tests`));
results.push(check('client: variant picking tests passed', passedNamed(/variantOfTile/) === 3, `${passedNamed(/variantOfTile/)} tests`));
results.push(check('sim: a standing sprite stands on a flat tile def', passedNamed(/tile defs a standing sprite has at least one variant and stands on a flat tile def/) === 1));
results.push(check('sim: sprite keys are unique', passedNamed(/tile defs no standing sprite shares its key/) === 1));
results.push(check('client: the generator paints what the tree def declares', passedNamed(/tree sheet generator/) === 2));
results.push(check('sim: a tree is still one solid tile', passedNamed(/tile defs a tree is still one solid tile to the sim/) === 1));
results.push(check('determinism test still passes', passedNamed(/determinism same seed \+ same commands = identical state/) === 1));

const headless = await run('pnpm', ['sim:headless']);
log += `\n$ pnpm sim:headless\n${headless.output}\n(exit ${headless.code})\n`;
const hash = /"hash":"([0-9a-f]+)"/.exec(headless.output)?.[1];
results.push(check(`the headless run ends on the same state hash as before the ticket (${STATE_HASH_BEFORE_THE_TICKET})`, headless.code === 0 && hash === STATE_HASH_BEFORE_THE_TICKET, `hash ${hash}`));

writeProof('01-check-output.txt', log);
writeProof('01-tests.json', report);
process.exit(summarize(results) ? 0 : 1);
