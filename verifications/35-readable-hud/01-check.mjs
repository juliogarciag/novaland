/** V1: the repository checks pass and the headless tests this ticket adds exist and pass. */
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
const names = report ? report.testResults.flatMap((file) => file.assertionResults.map((test) => ({ file: path.relative(ROOT, file.name), name: test.fullName, status: test.status }))) : [];
const passing = (pattern) => names.filter((test) => pattern.test(test.name) && test.status === 'passed').length;
results.push(check('every test passed, none skipped', report && report.numFailedTests === 0 && report.numPendingTests === 0 && report.numPassedTests === report.numTotalTests && report.numTotalTests > 0, `${report?.numPassedTests} of ${report?.numTotalTests}`));
results.push(check('the HUD lines: fps solo with no latency, seats, tick or movement help; fps, latency and seats online; -- for the unmeasured; you, players and the J hint kept', passing(/^hudLines /) === 5));
results.push(check('the frame rate counts rendered frames per second of real time, at any display rate, with no rate before the first second', passing(/^RenderedFrameRate /) === 4));
results.push(check('the connection has no latency until seated, then pings at once and reports the answered round trip', passing(/^WorldConnection has no latency until seated/) === 1));
results.push(check('it measures again every interval, one ping at a time, and shows how long an unanswered ping has waited', passing(/^WorldConnection (measures again every interval|shows how long an unanswered ping has waited)/) === 2));
results.push(check('the latency is forgotten on a drop and measured afresh for the next seat; junk round trips are ignored; closing stops the pings', passing(/^WorldConnection (forgets the latency when the connection drops|ignores a round trip that is not)/) === 2));
results.push(check('the connection, online world, sim and server tests that were there still pass', passing(/^WorldConnection /) >= 17 && passing(/^OnlineWorld /) >= 8 && passing(/same seed \+ same commands/) === 1 && passing(/^WorldRoom over a real connection/) >= 7));

writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
