/**
 * V1: the repository's own checks pass, and the headless tests this ticket
 * promises exist and pass by name: markers come from def data, tiles are
 * painted from their def's colour, a far thing goes to the edge, the
 * minimap keeps a bounded number of chunks whatever the map's size, and it
 * never covers the HUD lines.
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
results.push(check('pnpm test passes', tests.code === 0 && report?.success === true, report ? `${report.numPassedTests} of ${report.numTotalTests} tests in ${report.numTotalTestSuites} suites` : tests.output.slice(-300)));

const passedTitles = new Set((report?.testResults ?? []).flatMap((file) => file.assertionResults.filter((test) => test.status === 'passed').map((test) => `${path.basename(file.name)} > ${test.title}`)));
const promised = [
  ['landmarks.test.ts', 'lists the starting point of a map as a landmark on its spawn tile, kept on the edge when out of range'],
  ['minimap.test.ts', 'marks every avatar as a dot in its own colour, kept on the edge when far, and no tile: tiles are painted, not marked'],
  ['landmarks.test.ts', 'tells the starting point apart from every avatar by shape and by colour'],
  ['minimapMarks.test.ts', 'marks the starting point, the other players and the local player, in that drawing order, each where it is'],
  ['minimapMarks.test.ts', 'puts a thing that is out of range on the edge, on the straight line toward it'],
  ['minimapMarks.test.ts', 'leaves out a far thing whose marker says hidden, and shows it again once in range'],
  ['minimapMarks.test.ts', 'marks a far player on the edge too, in the colour of its avatar'],
  ['minimapMarks.test.ts', 'never jumps: a thing walking out of range slides to the edge distance, stays there, and only gains its arrow past the range'],
  ['minimapMarks.test.ts', 'leaves out a position that is not finite instead of drawing it somewhere: positions come from the server'],
  ['minimapMarks.test.ts', 'leaves out a def id that is no def or has no marker instead of throwing'],
  ['minimapMarks.test.ts', 'stops at MOST_ENTITY_MARKS entities however many a frame holds, and still marks the local player'],
  ['minimapMarks.test.ts', 'is where the frame drew the local player'],
  ['minimapMarks.test.ts', "stays where it was for a position no area can be at: not finite, or past the world's limit"],
  ['minimapTerrain.test.ts', 'paints every tile in the colour of its def, a pixel per tile, and leaves the rest transparent: on the world and on a generated map'],
  ['minimapTerrain.test.ts', 'does not depend on how big the world is: at most sixteen chunks drawn and twenty-five kept, on the world and on a map a hundred times its size'],
  ['minimapTerrain.test.ts', 'holds no chunk for a centre far outside the map, however large: positions come from the server'],
  ['minimapPlacement.test.ts', 'makes a tile a whole number of device pixels at every pixel ratio and window width, and is exactly 160 CSS pixels at whole ratios'],
  ['minimapPlacement.test.ts', 'moves below the HUD lines in a window too narrow to hold both side by side, and never covers them'],
  ['determinism.test.ts', 'same seed + same commands = identical state, including physics bytes'],
];
for (const [file, title] of promised) results.push(check(`${file}: ${title}`, passedTitles.has(`${file} > ${title}`)));

writeProof('01-check-output.txt', outputs.join('\n\n'));
writeProof('01-check.json', { results });
process.exit(summarize(results) ? 0 : 1);
