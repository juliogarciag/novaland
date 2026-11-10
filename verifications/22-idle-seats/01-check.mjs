/** V1: the repository checks pass, the idle-seat test exists and passes on a fake clock, and every #17 room test still passes. */
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
const names = report ? report.testResults.flatMap((file) => file.assertionResults.map((t) => ({ file: path.relative(ROOT, file.name), name: t.fullName, status: t.status, durationMs: t.duration }))) : [];
const passing = (pattern) => names.filter((t) => pattern.test(t.name) && t.status === 'passed');
results.push(check('every test passed, none skipped', report && report.numFailedTests === 0 && report.numPendingTests === 0 && report.numPassedTests === report.numTotalTests && report.numTotalTests > 0, `${report?.numPassedTests} of ${report?.numTotalTests}`));
const idleTest = passing(/frees the seat of a session with no accepted input for 10 minutes, closing it with 4100 "idle", and keeps one that plays/);
results.push(check('an idle session is kicked at the 10 minute timeout with 4100 "idle" on a fake clock, the playing one stays, the next joiner takes the seat', idleTest.length === 1));
results.push(check('the idle test ran on a fake clock, not on ten real minutes', idleTest.length === 1 && idleTest[0].durationMs < 10_000, `${idleTest[0]?.durationMs} ms`));
results.push(check('driven directly, the seat is free and the next join gets it before the kicked socket closes, and a non-positive timeout is refused', passing(/the moment it is kicked, before its socket closes, and refuses a timeout that is not positive/).length === 1));
results.push(check('a session holding one direction for three whole timeouts is never kicked, and is kicked a timeout after the move that stops it', idleTest.length === 1 && /also while it holds one direction for several timeouts/.test(idleTest[0].name)));
results.push(check('the client stays away after a 4100 that comes before the welcome, past the join timeout too', passing(/stays away after a 4100 that comes before the welcome/).length === 1));
results.push(check('the client stays away after a 4100 close and rejoins only when asked', passing(/stays away after the server frees an idle seat \(close 4100\), and rejoins only when asked/).length === 1));
results.push(check('the client still reconnects by itself after every other close code', passing(/still comes back by itself after every other close code/).length === 1));
results.push(check('the away screen tells the player they were away', passing(/describeStatus tells the player what is going on/).length === 1));
for (const [what, pattern] of [
  ['five players join by room id', /seats 5 players by room id/],
  ['every player sees the others move', /shows every player the others moving/],
  ['the sixth player is refused', /refuses the sixth player/],
  ['a leaver frees the seat for the next joiner', /frees the seat of a player who leaves/],
  ['junk is dropped while the world runs', /drops oversized, unknown, slot-carrying and malformed/],
  ['a flood spends the budget', /flooding player/],
  ['world/resync answers with one full state', /answers world\/resync/],
  ['an unknown-type flood closes its sender', /floods unknown message types/],
  ['a join that is never acknowledged is closed', /never acknowledges its join/],
  ['an oversized HTTP body is refused', /oversized HTTP request/],
  ['the room driven directly: a leave mid-join and a dispose mid-join', /leaves while its join is waiting|waiting for a tick when the room is disposed/],
]) {
  results.push(check(`#17 still holds: ${what}`, passing(pattern).length >= 1));
}
results.push(check('the sim, replica and client tests still pass', passing(/same seed \+ same commands/).length === 1 && passing(/^a replica fed /).length >= 5));

writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
