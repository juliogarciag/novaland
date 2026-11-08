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
results.push(check('every test passed', report && report.numFailedTests === 0 && report.numPassedTests > 0, `${report?.numPassedTests} passed`));
results.push(check('collider merging tests exist and pass', passing(/solid tile merging/).length >= 4, `${passing(/solid tile merging/).length} tests`));
results.push(check('trees block the player (headless)', passing(/trees block the player/).length === 1));
results.push(check('the player walks on paths (headless)', passing(/walks freely along a path/).length === 1));
results.push(check('rocks block the player (headless)', passing(/a rock blocks the player/).length === 1));
results.push(check('the starter spawn is on a dirt path (headless)', passing(/spawns the player on a dirt path/).length === 1));
results.push(check('the determinism test still passes', passing(/same seed \+ same commands/).length === 1));
results.push(check('terrain colliders are not drawn through getRenderables', passing(/none of them is drawn/).length === 1));
writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
