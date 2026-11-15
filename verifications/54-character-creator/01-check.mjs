/** V1: the repository checks pass, the headless tests this ticket adds exist and pass (malformed joins and the fuzz among them), and `pnpm sim:headless` still works. */
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

results.push(check('the name rule: normalised, counted in visible characters, refused when not text, empty, too long or holding control characters', passing(/^readCharacterName /).length === 5));
results.push(check('the character rule: every palette index and nothing outside, exactly a name and a look, never throws', passing(/^readCharacter /).length === 5));
results.push(check('a join spawns the character it carried, with the normalised name', passing(/^player\/join with a character (spawns the player with the look and the name|stores the normalised name)/).length === 2));
results.push(check('a malformed join (bad palette index, 21 characters, non-string name, no character) seats nobody and never throws', passing(/^player\/join with a character ignores a join whose character is not legal/).length === 1));
results.push(check('the sim is fuzzed with thousands of hostile joins: never a throw, never an illegal character', passing(/^fuzzing player\/join /).length === 2));
results.push(check('the name is in the snapshot as numbers and nothing of an earlier name is left behind', passing(/^snapshot records every component field/).length === 1 && passing(/^player\/join with a character leaves nothing of a name behind/).length === 1));
results.push(check('a character replicates in full states and deltas, and a replica shows a legal character whatever a server sends', passing(/^a character on a replica /).length === 2));
results.push(check('determinism still holds: same seed and commands give the same state', passing(/same seed \+ same commands/).length === 1 && passing(/^player\/join with a character keeps the same seed and joins deterministic/).length === 1));
results.push(check("the server's gate reads the character of the join options, refuses what is not legal and is fuzzed", passing(/^readJoinCharacter /).length === 3));
results.push(check('over a real connection: two players are two different characters for both; a join without a legal character is refused before it takes a seat', passing(/^WorldRoom over a real connection (seats two players as two different characters|refuses a join without a legal character|normalises the name at the gate)/).length === 3));
results.push(check('the client joins and rejoins as its character, and stops when the server refuses it', passing(/^WorldConnection (joins as the character it was given|stops for good when the server refuses the character|tells a refused character)/).length === 3));
results.push(check('the browser remembers the character and forgets one that is no longer legal', passing(/^the remembered character /).length === 4));
results.push(check("a look repaints the template sheet's colours and nothing else; the generator paints in those colours", passing(/^painting a look over the template sheet /).length === 4 && passing(/^player sheet generator /).length === 3));

const headless = await run('pnpm', ['sim:headless']);
transcript.push(`$ pnpm sim:headless (exit ${headless.code})\n${headless.output}`);
const headlessLine = headless.stdout.split('\n').find((line) => line.startsWith('{'));
const headlessResult = headlessLine ? JSON.parse(headlessLine) : null;
results.push(check('pnpm sim:headless still runs five simulated seconds and prints a hash', headless.code === 0 && headlessResult?.ticks === 300 && typeof headlessResult?.hash === 'string', headlessResult?.hash));

writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
