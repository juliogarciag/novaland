/**
 * V2: the world is the same ground as before. Runs same-ground.test.ts,
 * which compares the new code with what baseline/capture-sim.ts recorded on
 * the old code: every tile, the spawn, the colliders really in the physics
 * world, and a 40-second scripted walk of five players. It is a vitest file
 * because it reads the sim's physics world, which only a test may reach;
 * it writes proof/02-same-ground.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, check, run, summarize } from './lib.mjs';

const baseline = JSON.parse(readFileSync(path.join(import.meta.dirname, 'baseline/ground.json'), 'utf8'));
const baselineTiles = baseline.columns * baseline.rows;

const results = [];
const { code, output } = await run('pnpm', ['exec', 'vitest', 'run', '--config', 'verifications/47-world-as-chunks/vitest.config.ts', '--reporter=verbose']);
console.log(output.split('\n').filter((line) => /✓|×|✗|FAIL|Tests|Error/.test(line)).join('\n'));
results.push(check('the same-ground tests pass', code === 0, code === 0 ? undefined : output.slice(-600)));
let report;
try {
  report = JSON.parse(readFileSync(path.join(PROOF, '02-same-ground.json'), 'utf8'));
} catch {
  report = undefined;
}
results.push(check('every tile is the same tile at the same coordinate', report?.tiles.compared === baselineTiles && report.tiles.tilesStored === baselineTiles, report && `${report.tiles.compared} tiles compared, stored in ${report.tiles.chunks} chunks of ${report.tiles.chunkSize}x${report.tiles.chunkSize}`));
results.push(check('the spawn is the same tile and point', report?.spawn.tile.column === baseline.spawn.column && report.spawn.tile.row === baseline.spawn.row, report && JSON.stringify(report.spawn)));
results.push(check('the colliders cover the same ground: every solid tile once, nothing else, and none is an entity', report?.colliders.solidTilesCovered === report?.colliders.solidTiles && report?.colliders.terrainEntitiesNow === 0, report && `${report.colliders.boxesNow} boxes now (cut at the chunk edge), ${report.colliders.collidersBefore} entities before, both covering ${report.colliders.solidTiles} solid tiles`));
results.push(check('a 40-second walk of five players ends in the same places', report?.walk.worstDifferenceMetres < report?.walk.toleranceMetres, report && `largest difference ${(report.walk.worstDifferenceMetres * 1000).toFixed(1)} mm over ${report.walk.samples} samples, ${report.walk.samplesPressedAgainstSolidTiles} of them pressed against trees or rocks`));
process.exit(summarize(results) ? 0 : 1);
