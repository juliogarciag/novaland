/**
 * V1: the repository checks pass, the headless tests this ticket adds exist
 * and pass, and the bundles are still split the way ADR 0007 wants: the
 * page's own bundle holds no physics, Rapier is a chunk the page fetches
 * later.
 */
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
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
const passing = (pattern) => names.filter((test) => pattern.test(test.name) && test.status === 'passed');
results.push(check('every test passed, none skipped', Boolean(report) && report.numFailedTests === 0 && report.numPendingTests === 0 && report.numPassedTests === report.numTotalTests && report.numTotalTests > 0, `${report?.numPassedTests} of ${report?.numTotalTests}`));

results.push(check('the sim: a prediction refuses a capacity out of range, holds terrain only, adopts a player from a replica under the same id, walks it exactly as the server does (walls included), is replaced by the next adoption, refuses what it cannot give a body to, and leaves the server\'s sim untouched', passing(/^a prediction /).length === 8));
results.push(check('the sim: same seed + same commands still give the same state', passing(/same seed \+ same commands/).length >= 1));
results.push(check('the wire contract is pinned: protocol 2, player/move-applied, the protocol-mismatch refusal', passing(/^the wire contract .* pins the protocol version/).length === 1));
results.push(check('the room: acknowledges a move by sequence and tick just before the first update that includes it and tells nobody else; drops a malformed sequence; welcomes with its protocol and refuses another one without giving a seat', passing(/^WorldRoom over a real connection tells a player which of its moves/).length === 1 && passing(/^WorldRoom over a real connection drops a move whose sequence/).length === 1 && passing(/^WorldRoom over a real connection welcomes with protocol/).length === 1));
results.push(check('the edge gate: exactly { x, y, sequence }, a positive safe-integer sequence, never throws, and 20000 fuzzed payloads only ever yield a well-formed move', passing(/^readMoveMessage /).length === 7 && passing(/^speaksProtocol /).length === 1));
results.push(check('the client connection: hands over player/move-applied only while online, and stops as incompatible on a protocol refusal', passing(/^WorldConnection hands over a player\/move-applied/).length === 1 && passing(/^WorldConnection stops for good, as incompatible/).length === 1));
results.push(check('the online world refuses a welcome of another protocol or none', passing(/^OnlineWorld reports a server it cannot play on: another wire protocol or none/).length === 1));
const prediction = passing(/^OnlineWorld predicting the local player /);
results.push(check('prediction over a lagged link at 100 ms and 300 ms: moves on the frame of the key press; reconciling changes nothing when the server agrees; runs ahead by the round trip and no further; stops at a wall with the server; others stay on server states; jitter, a move never applied, a move altered by the server and a teleport are corrected; a new seat, a hidden tab, a frame hitch, a stalled link, a round trip over a second, a prediction that is missing, fails or loads mid-walk, and fuzzed acknowledgements are survived', prediction.length === 18, `${prediction.length} tests`));

const build = await run('pnpm', ['build']);
transcript.push(`$ pnpm build (exit ${build.code})\n${build.output}`);
const assetsDirectory = path.join(ROOT, 'packages/client/dist/assets');
const assets = existsSync(assetsDirectory) ? readdirSync(assetsDirectory) : [];
const indexHtml = existsSync(path.join(ROOT, 'packages/client/dist/index.html')) ? readFileSync(path.join(ROOT, 'packages/client/dist/index.html'), 'utf8') : '';
const pageScripts = [...indexHtml.matchAll(/assets\/([^"']+\.js)/g)].map((match) => match[1]);
const longestInlineBinary = Math.max(0, ...pageScripts.map((script) => Math.max(0, ...(readFileSync(path.join(assetsDirectory, script), 'utf8').match(/[A-Za-z0-9+/]{100000,}/g) ?? []).map((binary) => binary.length))));
const rapierChunks = assets.filter((asset) => /^rapier-.*\.js$/.test(asset));
results.push(check('pnpm build exits 0; Rapier is still a chunk of its own that index.html does not reference, and the script the page loads inlines no WASM (ADR 0007, now fetched after the seat)', build.code === 0 && rapierChunks.length === 1 && pageScripts.length > 0 && !pageScripts.some((script) => script.includes('rapier')) && longestInlineBinary === 0, JSON.stringify({ assets, pageScripts, longestInlineBinary })));

writeProof('01-check-output.txt', transcript.join('\n\n'));
writeProof('01-tests.json', names);
process.exit(summarize(results) ? 0 : 1);
