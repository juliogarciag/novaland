/** V1: the repository checks pass, the headless tests this ticket adds exist and pass, and `pnpm sim:headless` still works. */
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
results.push(check('the connection joins, goes online on the welcome and forwards updates only from then on', passing(/^WorldConnection joins, is online once the welcome/).length === 1));
results.push(check('a full world is shown and asked again, by itself and on retryNow', passing(/^WorldConnection shows a full world/).length === 1));
results.push(check('an unreachable or booting server is retried with a growing wait', passing(/^WorldConnection treats an unreachable server/).length === 1));
results.push(check('a drop leads to a fresh join and a new seat, and the dead room is ignored', passing(/^WorldConnection comes back after a drop/).length === 1));
results.push(check('a silent room or a join that never settles is abandoned by the client; an unusable welcome stops for good; close() never comes back, even from a join that settles late', passing(/^WorldConnection (abandons a room that never welcomes|abandons a join that never settles|stops for good|leaves and never comes back|leaves a room whose join settles only after close)/).length === 5));
results.push(check('a full world does not grow the wait of a later connection failure', passing(/^WorldConnection does not let a full world grow the wait/).length === 1));
results.push(check('a move is sent as exactly { x, y } and only while online', passing(/^WorldConnection sends a move as exactly/).length === 1));
results.push(check('the full-world refusal is told apart from a booting server and junk', passing(/^isWorldFullRefusal /).length === 2));
results.push(check('the online world resolves on the welcome with a replica, the seat and the player count', passing(/^OnlineWorld resolves once welcomed/).length === 1));
results.push(check('the online world never steps and follows deltas, drawing between them two send intervals behind', passing(/^OnlineWorld (never steps|follows deltas)/).length === 2));
results.push(check('a delta that does not chain is answered with one resync, asked again after enough misses; a refused welcome state is asked for once online; malformed updates are counted', passing(/^OnlineWorld (answers a delta that does not chain|asks again after enough further misses|asks for a full state once online|counts malformed updates)/).length === 4));
results.push(check('the screens describe every status', passing(/^describeStatus /).length === 1));
results.push(check('player/move goes out without its slot; after a drop the new seat is taken and the held move repeated', passing(/^OnlineWorld (sends the move of a player\/move|after a drop takes the new seat)/).length === 2));
results.push(check('a server the client cannot play on is reported, first time and after a drop', passing(/^OnlineWorld (reports a server it cannot play on|after a drop refuses a welcome)/).length === 2 && passing(/^readWelcome /).length === 1));
results.push(check('the frame buffer draws two send intervals behind at the display rate, holds on a stall, jumps on a gap, starts over on a restart', passing(/^ViewFrameBuffer /).length >= 6));
results.push(check('view frames are read from a sim and interpolated by entity id', passing(/^readViewFrame /).length === 1 && passing(/^interpolateViewFrames /).length === 5));
results.push(check('the sim, replica, world room and client tests still pass', passing(/same seed \+ same commands/).length === 1 && passing(/^a replica fed /).length >= 5 && passing(/^WorldRoom over a real connection/).length >= 7 && passing(/^takeWholeTicks (?!\(server)/).length === 5));

const headless = await run('pnpm', ['sim:headless']);
transcript.push(`$ pnpm sim:headless (exit ${headless.code})\n${headless.output}`);
const headlessLine = headless.stdout.split('\n').find((line) => line.startsWith('{'));
const headlessResult = headlessLine ? JSON.parse(headlessLine) : null;
results.push(check('pnpm sim:headless still runs five simulated seconds and prints a hash', headless.code === 0 && headlessResult?.ticks === 300 && typeof headlessResult?.hash === 'string', headlessResult?.hash));

writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
