/**
 * Runs the region script and checks that what it writes is what is
 * committed: the map in the repo is the public data put through the script,
 * with nothing edited by hand. The first run downloads the data (about
 * 430 MB of cache under scripts/region/.cache); later runs read the cache.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, ROOT, check, summarize, writeProof } from './lib.mjs';

const REGION_MODULE = 'packages/sim/src/content/world/regions/alps.ts';
const results = [];
let report;

try {
  const before = readFileSync(path.join(ROOT, REGION_MODULE), 'utf8');
  const output = execFileSync('node', ['scripts/region/build-region.mjs', 'alps', '--report', path.join(PROOF, '01-build-report.json')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  results.push(check('the script ran and wrote the region', output.includes(`wrote ${REGION_MODULE}`)));
  const after = readFileSync(path.join(ROOT, REGION_MODULE), 'utf8');
  results.push(check('the committed map is exactly what the script makes from the public data', before === after, `${after.length} characters`));

  report = JSON.parse(readFileSync(path.join(PROOF, '01-build-report.json'), 'utf8'));
  const { grid, bounds, tilesByKind, riverTiles, walkableReachFromSpawn, filesWithNoData } = report;
  results.push(check('the map is 896x640 tiles at 0.6 km a tile', grid.columns === 896 && grid.rows === 640 && grid.kilometresPerTile === 0.6, `${grid.columns}x${grid.rows}, ${(grid.columns * grid.kilometresPerTile).toFixed(0)} km by ${(grid.rows * grid.kilometresPerTile).toFixed(0)} km`));
  results.push(check('it runs from west of Geneva to east of Venice', bounds.west < 6.15 && bounds.east > 12.33 && bounds.south < 45.44 && bounds.north > 46.2, `${bounds.south.toFixed(2)}N to ${bounds.north.toFixed(2)}N, ${bounds.west.toFixed(2)}E to ${bounds.east.toFixed(2)}E`));
  results.push(check('every dataset had a file for every part of the region', filesWithNoData.elevation.length === 0 && filesWithNoData.landCover.length === 0));
  const emptyKinds = Object.entries(tilesByKind).filter(([, count]) => count === 0).map(([kind]) => kind);
  results.push(check('every kind of tile the script knows is on the map', emptyKinds.length === 0, emptyKinds.length === 0 ? Object.entries(tilesByKind).map(([kind, count]) => `${kind} ${count}`).join(', ') : `none of: ${emptyKinds.join(', ')}`));
  const bigRivers = ['Po', 'Rhône', 'Rhein', 'Inn', 'Adige', 'Aare', 'Ticino', 'Adda'];
  const missingRivers = bigRivers.filter((river) => !(riverTiles[river] > 100));
  results.push(check('the big rivers are drawn, each over more than 100 tiles', missingRivers.length === 0, missingRivers.length === 0 ? bigRivers.map((river) => `${river} ${riverTiles[river]}`).join(', ') : `missing: ${missingRivers.join(', ')}`));
  const reach = walkableReachFromSpawn.reachedCount / walkableReachFromSpawn.walkableCount;
  results.push(check('more than 99% of the walkable ground can be walked to from the spawn', reach > 0.99, `${(reach * 100).toFixed(2)}%: ${walkableReachFromSpawn.reachedCount} of ${walkableReachFromSpawn.walkableCount} tiles`));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
}

writeProof('01-build.json', { results, report });
process.exit(summarize(results) ? 0 : 1);
