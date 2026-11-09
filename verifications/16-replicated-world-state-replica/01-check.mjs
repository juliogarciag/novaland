/** V1: the repository checks pass, and the headless tests the ticket asks for exist and pass. */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { PROOF, ROOT, check, run, summarize, writeProof } from './lib.mjs';

const results = [];
const transcript = [];
for (const [name, args] of [
  ['pnpm install', ['install', '--frozen-lockfile']],
  ['pnpm typecheck', ['typecheck']],
  ['pnpm lint', ['lint']],
]) {
  const { code, output } = await run('pnpm', args);
  transcript.push(`$ ${name}\n${output}`);
  results.push(check(`${name} exits 0`, code === 0));
}

const reportFile = path.join(PROOF, '01-tests-report.json');
const tests = await run('pnpm', ['exec', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`]);
transcript.push(`$ pnpm exec vitest run --reporter=default --reporter=json (exit ${tests.code})\n${tests.output}`);
results.push(check('pnpm test exits 0', tests.code === 0));
const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
if (existsSync(reportFile)) unlinkSync(reportFile);
const names = report ? report.testResults.flatMap((file) => file.assertionResults.map((t) => ({ file: path.relative(ROOT, file.name), name: t.fullName, status: t.status }))) : [];
const passing = (pattern) => names.filter((t) => pattern.test(t.name) && t.status === 'passed');
results.push(check('every test passed, none skipped', report && report.numFailedTests === 0 && report.numPendingTests === 0 && report.numPassedTests === report.numTotalTests && report.numTotalTests > 0, `${report?.numPassedTests} of ${report?.numTotalTests}`));
results.push(check('a replica fed full states every tick draws what the sim draws', passing(/full world states every tick.*draws exactly what the sim draws/).length === 1));
results.push(check('a replica fed deltas matches the sim at every send, through joins, leaves and a recycled id', passing(/deltas at a send rate.*matches the sim at every send/).length === 1));
results.push(check('removed entities disappear and an out-of-sequence delta is reported', passing(/removes an entity that left and reports a delta/).length === 1));
results.push(check('deltas never carry the terrain again', passing(/never sends the terrain again/).length === 1));
results.push(check('a full state from a restarted server replaces the replica', passing(/replaced whole by a full state/).length === 1));
results.push(check('replica.step throws and a live sim is refused by applyWorldState', passing(/refuses to step/).length === 1 && passing(/live sim is refused loudly/).length === 1));
results.push(check('malformed network data is ignored, never thrown on', passing(/applyWorldState with data from the network/).length >= 5));
results.push(check('a DefRef at no def does not crash the view', passing(/keeps the view alive when an entity points at a def that does not exist/).length === 1));
results.push(check('diff -> apply rebuilds the next state exactly, through JSON', passing(/rebuilds the later state exactly/).length === 1));
results.push(check('ensureEntityExists agrees with a model over 2000 random steps', passing(/agrees with a plain model/).length === 1));
results.push(check('the determinism test still passes', passing(/same seed \+ same commands/).length === 1));
results.push(check('the snapshot tests still pass (shared entity snapshot code)', passing(/^snapshot /).length >= 5));
writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
