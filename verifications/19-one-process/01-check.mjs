/** V1: the repository checks pass and the headless tests this ticket adds exist and pass (the origin policy, the one-process HTTP edge, the request guard, the edge routes, the whole server on one port, the client's server-url choice, physics on demand), and loading Rapier on demand left the sim's state hash unchanged. */
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
results.push(check('the origin policy: no Origin passes, the listed origins pass in any spelling, other hosts/ports/schemes/null/junk are refused, the request never says who it is (no Host comparison), loopback pages pass outside production only, a name that merely looks like loopback does not, and * allows all', passing(/^isOriginAllowed /).length === 8));
results.push(check('ALLOWED_ORIGINS is parsed strictly: unset is loopback only outside production and stops the boot in production, entries are normalised, anything that is not a bare http(s) origin throws', passing(/^readOriginPolicy /).length === 4));
results.push(check('one process, the real composition: index.html with security headers, immutable hashed assets, ETag/HEAD/range, compression, no escape from the directory, no descriptor left open by an aborted download, /healthz, 403 for foreign matchmaking and upgrades (a rebound domain too), no wildcard CORS, files and health open to everyone, the body cap, 400 for every request Colyseus cannot survive, a real client seated through all of it, a proxied request let through', passing(/^one process: /).length === 17));
results.push(check('one process in production: only the listed origin gets in, whatever Host a proxy presents; a loopback page and a rebound domain do not', passing(/^one process in production: /).length === 3));
results.push(check('the request guard alone: installs only over exactly one listener, pre-reads bodies, 413 over the cap, 403 for foreign state changes, reads stay open, a forwarded protocol in either case', passing(/^guardRequests /).length === 8));
results.push(check('the edge routes alone: /healthz is 503 until there is something to report, HEAD has no body, nothing is served without a client directory', passing(/^mountEdgeRoutes /).length === 3));
results.push(check('the client picks the server: VITE_SERVER_URL when set, the page origin in production, solo in dev', passing(/^worldServerUrl /).length === 3));
results.push(check('physics loads on demand: a replica works with none loaded, a physics world before initPhysics throws a clear error, and Rapier loads once', passing(/^physics loads on demand /).length === 3));
results.push(check('the sim, replica, world room and client online tests still pass', passing(/same seed \+ same commands/).length === 1 && passing(/^a replica fed /).length >= 5 && passing(/^WorldRoom over a real connection/).length >= 7 && passing(/^WorldConnection /).length >= 5));

// ADR 0007 claims loading Rapier on demand changed nothing in the sim: the hash #18 recorded, before that change, still comes out.
const headless = await run('pnpm', ['sim:headless']);
transcript.push(`$ pnpm sim:headless (exit ${headless.code})\n${headless.output}`);
const headlessHash = headless.output.match(/"hash":"([0-9a-f]+)"/)?.[1];
const hashBeforeOnDemand = readFileSync(path.join(ROOT, 'verifications/18-client-online-mode/proof/01-check.txt'), 'utf8').match(/pnpm sim:headless .*\(([0-9a-f]+)\)/)?.[1];
results.push(check('pnpm sim:headless prints the same state hash as before Rapier loaded on demand (recorded in #18\'s proof)', headless.code === 0 && headlessHash !== undefined && headlessHash === hashBeforeOnDemand, `${headlessHash} vs ${hashBeforeOnDemand}`));

writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
