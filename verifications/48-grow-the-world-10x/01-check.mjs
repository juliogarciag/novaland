/**
 * V1: the repository's own checks pass, and the headless tests this ticket
 * promises exist and pass by name: every walkable tile of the world can be
 * reached from the spawn, the areas leave no hole, the world is ten times
 * the clearing with the clearing and the spawn where they were, and trees
 * close its outer edge.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, check, run, summarize, writeProof } from './lib.mjs';

const results = [];
const outputs = [];
for (const [name, args] of [
  ['pnpm install', ['install', '--frozen-lockfile']],
  ['pnpm typecheck', ['typecheck']],
  ['pnpm lint', ['lint']],
  ['pnpm build', ['build']],
]) {
  const { code, output } = await run('pnpm', args);
  outputs.push(`$ ${name}\n${output}`);
  results.push(check(`${name} passes`, code === 0, code === 0 ? undefined : output.slice(-300)));
}
const testReport = path.join(PROOF, '01-tests.json');
const tests = await run('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${testReport}`]);
outputs.push(`$ pnpm exec vitest run --reporter=json\n${tests.output}`);
let report;
try {
  report = JSON.parse(readFileSync(testReport, 'utf8'));
} catch {
  report = undefined;
}
// Vitest writes absolute paths; proof keeps none.
if (report) writeProof('01-tests.json', JSON.stringify(report));
results.push(check('pnpm test passes', tests.code === 0 && report?.success === true, report ? `${report.numPassedTests} of ${report.numTotalTests} tests in ${report.numTotalTestSuites} suites` : tests.output.slice(-300)));

const passedTitles = new Set((report?.testResults ?? []).flatMap((file) => file.assertionResults.filter((test) => test.status === 'passed').map((test) => `${path.basename(file.name)} > ${test.title}`)));
const promised = [
  ['world.test.ts', 'spawns on grass, with every other walkable tile of every area within reach on foot'],
  ['world.test.ts', 'counts reach in whole tiles a player fits through: every avatar is narrower than one tile'],
  ['world.test.ts', 'is the clearing, with its top-left tile on the origin, and areas on every side of it: ten times the clearing in all'],
  ['world.test.ts', 'is one continuous outdoors: the areas cover the rectangle that holds them, with no tile missing'],
  ['world.test.ts', 'keeps areas small enough to edit by hand: none is much larger than the clearing'],
  ['world.test.ts', 'is ringed by trees with no gap, so nothing walks off the map'],
  ['world.test.ts', 'has no paths: every tile is grass, a tree or a rock'],
  ['determinism.test.ts', 'same seed + same commands = identical state, including physics bytes'],
];
for (const [file, title] of promised) results.push(check(`${file}: ${title}`, passedTitles.has(`${file} > ${title}`)));

// Content only: nothing under the sim's core changed since the branch this one is stacked on.
const mergeBase = await run('git', ['merge-base', 'HEAD', 'origin/47-world-as-chunks']);
const base = mergeBase.output.trim();
const diff = mergeBase.code === 0 ? await run('git', ['diff', '--name-only', base, 'HEAD']) : { code: 1, output: '' };
const changed = diff.output.trim().split('\n').filter(Boolean);
const core = changed.filter((file) => file.startsWith('packages/sim/src/core/'));
const hasDiff = mergeBase.code === 0 && diff.code === 0 && /^[0-9a-f]{40}$/.test(base) && changed.length > 0;
results.push(check('git names the files changed since the branch this one is stacked on', hasDiff, hasDiff ? `${changed.length} files since ${base.slice(0, 7)}` : `${mergeBase.output} ${diff.output}`.slice(0, 200)));
results.push(check('no file under packages/sim/src/core changed', hasDiff && core.length === 0, core.join(' ')));
const format = changed.filter((file) => ['packages/sim/src/content/world/types.ts', 'packages/sim/src/content/world/tiles.ts'].includes(file));
results.push(check('the area format (types.ts, tiles.ts) did not change', hasDiff && format.length === 0, format.join(' ')));

writeProof('01-check-output.txt', outputs.join('\n\n'));
writeProof('01-check.json', { changedFiles: changed, results });
process.exit(summarize(results) ? 0 : 1);
