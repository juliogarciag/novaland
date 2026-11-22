/**
 * Makes a region of the real Earth into a map the sim can play: reads
 * public elevation, land cover, river and lake data for the region's bounds
 * and writes `packages/sim/src/content/world/regions/<name>.ts`, a file of
 * tile rows the sim imports like any other content.
 *
 *   pnpm region:build                      # the Alps
 *   pnpm region:build alps --report <file> # also writes what it measured as JSON
 *
 * The first run downloads the overviews it needs (the cache ends at about 100 MB) into `scripts/region/.cache/` (not
 * committed); later runs read from there. The same inputs always write the
 * same file. See `scripts/region/README.md` for the sources and their licences.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile, readRasterOverview } from './downloads.mjs';
import { boundsOfGrid, gridOfRegion } from './projection.mjs';
import { alps } from './regions/alps.mjs';
import { addElevationSample, addLandCoverSample, drawRivers, emptyTallies, fillLakes, kindsFromTallies, meanElevations, ringWaterWithShallows, tallyRaster, walkableReach, walkableTileNearest } from './regionTiles.mjs';
import { elevationSource, filesCovering, landCoverSource, waterSource } from './sources.mjs';
import { TILE_KINDS } from './tileKinds.mjs';
import { regionModuleText } from './writeRegion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIRECTORY = path.join(here, '.cache');
const REGIONS_DIRECTORY = path.resolve(here, '../../packages/sim/src/content/world/regions');
const regions = { alps };

/** How many files are fetched at once. */
const DOWNLOADS_AT_ONCE = 6;

async function main() {
  const flags = process.argv.slice(2);
  const reportFlag = flags.indexOf('--report');
  const reportFile = reportFlag >= 0 ? flags[reportFlag + 1] : undefined;
  if (reportFlag >= 0 && !reportFile) throw new Error('--report needs a file');
  const regionName = flags.find((flag, index) => !flag.startsWith('--') && index !== reportFlag + 1) ?? 'alps';
  const region = regions[regionName];
  if (!region) throw new Error(`No region is called "${regionName}". There is: ${Object.keys(regions).join(', ')}`);

  const grid = gridOfRegion(region);
  const bounds = boundsOfGrid(grid);
  console.log(`${region.name}: ${grid.columns}x${grid.rows} tiles of ${grid.kilometresPerTile} km, ${bounds.south.toFixed(3)}N to ${bounds.north.toFixed(3)}N, ${bounds.west.toFixed(3)}E to ${bounds.east.toFixed(3)}E`);

  const tallies = emptyTallies(grid);
  const missingElevationFiles = await tallySource({ grid, source: elevationSource, addSample: addElevationSample(tallies) });
  const missingLandCoverFiles = await tallySource({ grid, source: landCoverSource, addSample: addLandCoverSample(tallies) });
  const kinds = kindsFromTallies(grid, tallies);

  const lakes = (await readFeatures(waterSource.lakeFiles)).filter((feature) => feature.properties?.featurecla !== 'Playa');
  const lakeTilesAdded = fillLakes({ grid, kinds, lakes });
  const riverTiles = drawRivers({ grid, kinds, rivers: await readFeatures(waterSource.riverFiles) });
  ringWaterWithShallows({ grid, kinds });

  const spawn = walkableTileNearest({ grid, kinds, coordinates: region.spawn });
  const rows = Array.from({ length: grid.rows }, (_, row) => Array.from(kinds.subarray(row * grid.columns, (row + 1) * grid.columns), (kind) => TILE_KINDS[kind].character).join(''));
  const usedKinds = TILE_KINDS.filter((_, index) => kinds.includes(index));
  const moduleFile = path.join(REGIONS_DIRECTORY, `${region.name}.ts`);
  mkdirSync(REGIONS_DIRECTORY, { recursive: true });
  writeFileSync(moduleFile, regionModuleText({ name: region.name, grid, rows, spawn, kinds: usedKinds, sources: [elevationSource, landCoverSource, waterSource] }));
  console.log(`wrote ${path.relative(process.cwd(), moduleFile)}`);

  const report = {
    region: region.name,
    grid,
    bounds,
    spawn,
    tilesByKind: Object.fromEntries(TILE_KINDS.map((kind, index) => [kind.name, kinds.reduce((count, value) => count + (value === index ? 1 : 0), 0)])),
    highestTileMetres: Math.round(meanElevations(tallies).reduce((highest, metres) => Math.max(highest, metres), 0)),
    lakeTilesAdded,
    riverTiles,
    walkableReachFromSpawn: walkableReach({ grid, kinds, from: spawn }),
    filesWithNoData: { elevation: missingElevationFiles, landCover: missingLandCoverFiles },
  };
  console.log(JSON.stringify({ ...report, riverTiles: `${Object.keys(riverTiles).length} rivers` }, null, 2));
  if (reportFile) {
    mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true });
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${reportFile}`);
  }
}

/** Reads every file of a raster source that touches the grid and adds its samples to the tiles. Returns the files the source does not have. */
async function tallySource({ grid, source, addSample }) {
  const files = filesCovering(source, boundsOfGrid(grid));
  const missing = [];
  for (let first = 0; first < files.length; first += DOWNLOADS_AT_ONCE) {
    const batch = files.slice(first, first + DOWNLOADS_AT_ONCE);
    const rasters = await Promise.all(batch.map((file) => readRasterOverview({ url: source.urlOfFile(file), overviewWidth: source.overviewWidth, cacheDirectory: CACHE_DIRECTORY })));
    rasters.forEach((raster, index) => {
      if (raster) tallyRaster({ grid, file: batch[index], degreesPerFile: source.degreesPerFile, raster, addSample });
      else missing.push(path.basename(source.urlOfFile(batch[index])));
    });
    console.log(`${source.name}: ${Math.min(first + DOWNLOADS_AT_ONCE, files.length)}/${files.length} files`);
  }
  return missing;
}

async function readFeatures(files) {
  const collections = await Promise.all(files.map((file) => readJsonFile({ url: waterSource.urlOfFile(file), cacheDirectory: CACHE_DIRECTORY })));
  return collections.flatMap((collection) => collection.features);
}

await main();
