/**
 * V1: the repository's own checks pass, and the headless tests this ticket
 * promises exist and pass by name: the world grows without moving anything,
 * a second area mounts where it reserved, an overlap is refused, terrain is
 * in no world state, a prediction takes no entity id for terrain, and the
 * welcome names the map.
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
  ['world.test.ts', 'keeps every existing tile, tile coordinate and position in metres when an area is added on any side'],
  ['world.test.ts', 'mounts a second area at the coordinates it reserves: its tiles and its colliders are there, in the same world'],
  ['world.test.ts', 'a player inside a mounted area is stopped by its walls'],
  ['world.test.ts', 'refuses an area that overlaps another by even one tile, naming both, and two areas with one name'],
  ['world.test.ts', 'gives the same checksum to the same terrain however it is cut into areas, and another to any other terrain or spawn'],
  ['world.test.ts', 'stores tiles in chunks of CHUNK_SIZE, top row first then left to right, and only the chunks that hold a tile'],
  ['terrain.test.ts', 'builds one static box per merged rectangle, chunk by chunk, and no entity at all'],
  ['terrain.test.ts', 'builds the same boxes in the same order every time, and the same physics bytes'],
  ['terrain.test.ts', 'a wall that crosses a chunk edge is as solid at the seam as anywhere else'],
  ['determinism.test.ts', 'same seed + same commands = identical state, including physics bytes'],
  ['prediction.test.ts', 'starts with the same terrain colliders as a sim of the map and no entity at all, and steps like a sim'],
  ['prediction.test.ts', 'takes no entity id for terrain, however big the map: the first id a server hands a player is free to adopt'],
  ['prediction.test.ts', 'adopts a player from a replica under the same id and walks it exactly as the server does, walls included'],
  ['replica.test.ts', 'never sends terrain at all: a full state holds the players and nothing else, deltas only the players that moved'],
  ['replica.test.ts', 'pins the protocol version, the message names, the refusal reasons and the default send rate ADR 0004, 0011 and 0013 list'],
  ['worldRoom.test.ts', 'seats 5 players by room id, each welcomed with its own seat and already in the world'],
  ['OnlineWorld.test.ts', 'reports a server it cannot play on: another wire protocol or none, another map, a capacity out of range, a welcome of the wrong shape'],
  ['OnlineWorld.test.ts', 'after a drop refuses a welcome for another map: a server redeployed with new terrain'],
  ['chunkRange.test.ts', 'does not depend on how big the world is: a screen of 60 by 34 tiles never needs more than nine chunks drawn'],
  ['standingTiles.test.ts', 'draws the eastern of two trees in a row on top whichever was created first, by far less than a pixel of depth'],
  ['groundTiles.test.ts', 'shows every grass tile in the variant its world column and row pick, wherever its chunk is'],
];
for (const [file, title] of promised) results.push(check(`${file}: ${title}`, passedTitles.has(`${file} > ${title}`)));
writeProof('01-check-output.txt', outputs.join('\n\n'));
process.exit(summarize(results) ? 0 : 1);
