/** V1: the repository checks pass and the headless tests this ticket adds exist and pass (the origin policy, the one-process HTTP edge, the client's server-url choice). */
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
results.push(check('the origin policy: no Origin passes, same origin passes whatever the scheme, foreign hosts/ports/null/junk are refused, the allow-list and * work, loopback to loopback passes but not loopback to a deployed host', passing(/^isOriginAllowed /).length === 7));
results.push(check('ALLOWED_ORIGINS is parsed strictly: unset is same-origin only, entries are normalised, anything that is not a bare origin throws', passing(/^readAllowedOrigins /).length === 3));
results.push(check('one process: index.html with security headers, immutable hashed assets, ETag/HEAD, no escape from the directory, hand-over to Colyseus, no descriptor left open by an aborted download, /healthz, 403 for foreign matchmaking and upgrades, files and health still open to everyone; a client directory with "assets" in its own path still caches only assets/', passing(/^one process: /).length === 10 && passing(/^serveClientFiles with a client directory/).length === 1));
results.push(check('the client picks the server: VITE_SERVER_URL when set, the page origin in production, solo in dev', passing(/^worldServerUrl /).length === 3));
results.push(check('the sim, replica, world room and client online tests still pass', passing(/same seed \+ same commands/).length === 1 && passing(/^a replica fed /).length >= 5 && passing(/^WorldRoom over a real connection/).length >= 7 && passing(/^WorldConnection /).length >= 5));

writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
