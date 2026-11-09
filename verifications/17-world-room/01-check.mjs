/** V1: the repository checks pass, the room's tests exist and pass, and `pnpm sim:headless` still works. */
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
results.push(check('five players join by room id and are welcomed into the world', passing(/seats 5 players by room id/).length === 1));
results.push(check('every player sees the others move through chained deltas', passing(/shows every player the others moving/).length === 1));
results.push(check('the sixth player is refused, as are create / join / joinOrCreate', passing(/refuses the sixth player/).length === 1));
results.push(check('a leaver frees the seat, vanishes for the others, and the next joiner takes it', passing(/frees the seat of a player who leaves/).length === 1));
results.push(check('oversized, unknown, slot-carrying and malformed messages are dropped while the world runs', passing(/drops oversized, unknown, slot-carrying and malformed/).length === 1));
results.push(check('a flood spends the budget, a refused frame disconnects only its sender', passing(/flooding player/).length === 1));
results.push(check('world/resync answers with one full state', passing(/answers world\/resync/).length === 1));
results.push(check('the inbound gate is unit tested (exact shape, finite numbers, never throws, budget)', passing(/^readMoveMessage /).length >= 5 && passing(/^MessageBudget /).length >= 2 && passing(/^payloadLength /).length === 1));
results.push(check('seats hand out the lowest free slot', passing(/^Seats /).length === 3));
results.push(check('the server tick helper caps the catch-up', passing(/takeWholeTicks \(server copy/).length === 5));
results.push(check('the sim, replica and client tests still pass', passing(/same seed \+ same commands/).length === 1 && passing(/^a replica fed /).length >= 5 && passing(/^takeWholeTicks (?!\(server)/).length === 5));

const headless = await run('pnpm', ['sim:headless']);
transcript.push(`$ pnpm sim:headless (exit ${headless.code})\n${headless.output}`);
const headlessLine = headless.stdout.split('\n').find((line) => line.startsWith('{'));
const headlessResult = headlessLine ? JSON.parse(headlessLine) : null;
results.push(check('pnpm sim:headless still runs five simulated seconds and prints a hash', headless.code === 0 && headlessResult?.ticks === 300 && typeof headlessResult?.hash === 'string', headlessResult?.hash));

writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
