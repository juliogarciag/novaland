/**
 * Turns what the datasets say into the tiles of a region. Everything here
 * is plain arithmetic on arrays, with no files and no network, so tests can
 * feed it small made-up inputs.
 *
 * A grid of tiles is kept as one array, row by row from the north-west
 * corner: the tile at (column, row) is at `row * columns + column`.
 */
import { boundsOfGrid, gridPositionOf } from './projection.mjs';
import { isInsidePolygon, tilesAlongSegment } from './shapes.mjs';
import { COVER_GROUPS, coverGroupIndexOf, kindIndexByName, kindOfTile, TILE_KINDS } from './tileKinds.mjs';

/** Empty tallies for a grid: what the samples of the rasters add up to in each tile. */
export function emptyTallies(grid) {
  const tileCount = grid.columns * grid.rows;
  return {
    elevationSum: new Float64Array(tileCount),
    elevationSamples: new Uint32Array(tileCount),
    /** `coverCounts[tile * COVER_GROUPS.length + group]`. */
    coverCounts: new Uint32Array(tileCount * COVER_GROUPS.length),
  };
}

/**
 * Adds every sample of one raster file to the tile it falls in. The file
 * covers `degreesPerFile` degrees each way from its south-west corner
 * (`file`), and `raster` holds its samples from the north-west corner.
 * `addSample(tileIndex, sample)` does the adding.
 */
export function tallyRaster({ grid, file, degreesPerFile, raster, addSample }) {
  const columnOfX = new Int32Array(raster.width);
  for (let x = 0; x < raster.width; x += 1) {
    const { column } = gridPositionOf(grid, { latitude: 0, longitude: file.west + ((x + 0.5) * degreesPerFile) / raster.width });
    columnOfX[x] = column >= 0 && column < grid.columns ? Math.floor(column) : -1;
  }
  for (let y = 0; y < raster.height; y += 1) {
    const { row } = gridPositionOf(grid, { latitude: file.south + degreesPerFile - ((y + 0.5) * degreesPerFile) / raster.height, longitude: 0 });
    if (row < 0 || row >= grid.rows) continue;
    const firstTileOfRow = Math.floor(row) * grid.columns;
    for (let x = 0; x < raster.width; x += 1) {
      if (columnOfX[x] >= 0) addSample(firstTileOfRow + columnOfX[x], raster.samples[y * raster.width + x]);
    }
  }
}

export function addElevationSample(tallies) {
  return (tileIndex, metres) => {
    if (!Number.isFinite(metres)) return;
    tallies.elevationSum[tileIndex] += metres;
    tallies.elevationSamples[tileIndex] += 1;
  };
}

export function addLandCoverSample(tallies) {
  return (tileIndex, landCoverClass) => {
    const group = coverGroupIndexOf(landCoverClass);
    if (group !== undefined) tallies.coverCounts[tileIndex * COVER_GROUPS.length + group] += 1;
  };
}

/** The mean height of every tile in metres; 0 where no elevation sample fell, which is open sea. */
export function meanElevations(tallies) {
  return Float32Array.from(tallies.elevationSum, (sum, tileIndex) => (tallies.elevationSamples[tileIndex] > 0 ? sum / tallies.elevationSamples[tileIndex] : 0));
}

/** The kind of every tile (an index into `TILE_KINDS`) from the tallies alone: land cover and height, no rivers yet. */
export function kindsFromTallies(grid, tallies) {
  const elevations = meanElevations(tallies);
  const kinds = new Uint8Array(grid.columns * grid.rows);
  for (let tileIndex = 0; tileIndex < kinds.length; tileIndex += 1) {
    const coverCounts = tallies.coverCounts.subarray(tileIndex * COVER_GROUPS.length, (tileIndex + 1) * COVER_GROUPS.length);
    kinds[tileIndex] = kindIndexByName[kindOfTile({ coverCounts, meanElevation: elevations[tileIndex] })];
  }
  return kinds;
}

/**
 * Makes every tile whose centre is inside a lake water. The land cover
 * already shows a lake wider than a tile; this keeps the narrow arms of the
 * long ones in one piece. `lakes` are GeoJSON features with Polygon or
 * MultiPolygon geometry. Returns how many tiles it changed.
 */
export function fillLakes({ grid, kinds, lakes }) {
  let changed = 0;
  for (const polygon of lakes.flatMap(polygonsOf)) {
    const rings = polygon.map((ring) => ring.map(([longitude, latitude]) => gridPositionOf(grid, { latitude, longitude })));
    const outer = rings[0];
    const firstRow = Math.max(0, Math.floor(Math.min(...outer.map((position) => position.row))));
    const lastRow = Math.min(grid.rows - 1, Math.floor(Math.max(...outer.map((position) => position.row))));
    const firstColumn = Math.max(0, Math.floor(Math.min(...outer.map((position) => position.column))));
    const lastColumn = Math.min(grid.columns - 1, Math.floor(Math.max(...outer.map((position) => position.column))));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const tileIndex = row * grid.columns + column;
        if (kinds[tileIndex] === kindIndexByName.water || !isInsidePolygon(rings, { column: column + 0.5, row: row + 0.5 })) continue;
        kinds[tileIndex] = kindIndexByName.water;
        changed += 1;
      }
    }
  }
  return changed;
}

/**
 * Draws every river one tile wide along its line, so a river far narrower
 * than a tile still exists. A river tile replaces walkable ground only:
 * where the line crosses a lake, the sea, a glacier or a summit, that tile
 * stays. `rivers` are GeoJSON features with LineString or MultiLineString
 * geometry. Returns, by river name, how many tiles each one got.
 */
export function drawRivers({ grid, kinds, rivers }) {
  const bounds = boundsOfGrid(grid);
  const tilesByRiver = new Map();
  for (const river of rivers) {
    const name = river.properties?.name || 'unnamed';
    for (const line of linesOf(river)) {
      for (let index = 1; index < line.length; index += 1) {
        const [startLongitude, startLatitude] = line[index - 1];
        const [endLongitude, endLatitude] = line[index];
        const isOutside =
          Math.max(startLongitude, endLongitude) < bounds.west || Math.min(startLongitude, endLongitude) > bounds.east || Math.max(startLatitude, endLatitude) < bounds.south || Math.min(startLatitude, endLatitude) > bounds.north;
        if (isOutside) continue;
        const tiles = tilesAlongSegment(gridPositionOf(grid, { latitude: startLatitude, longitude: startLongitude }), gridPositionOf(grid, { latitude: endLatitude, longitude: endLongitude }));
        for (const { column, row } of tiles) {
          if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) continue;
          const tileIndex = row * grid.columns + column;
          if (kinds[tileIndex] === kindIndexByName.river || TILE_KINDS[kinds[tileIndex]].solid) continue;
          kinds[tileIndex] = kindIndexByName.river;
          tilesByRiver.set(name, (tilesByRiver.get(name) ?? 0) + 1);
        }
      }
    }
  }
  return Object.fromEntries([...tilesByRiver].sort(([first], [second]) => first.localeCompare(second)));
}

/**
 * Turns every water tile that touches something that is not water, corners
 * included, into shallows: the ring where the coast is drawn (ADR 0016).
 * Past the edge of the map counts as more water, so the sea runs off the map deep.
 */
export function ringWaterWithShallows({ grid, kinds }) {
  const isWater = (column, row) => column < 0 || column >= grid.columns || row < 0 || row >= grid.rows || kinds[row * grid.columns + column] === kindIndexByName.water;
  const shallows = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      if (!isWater(column, row)) continue;
      let touchesLand = false;
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) touchesLand ||= !isWater(column + columnOffset, row + rowOffset);
      if (touchesLand) shallows.push(row * grid.columns + column);
    }
  }
  for (const tileIndex of shallows) kinds[tileIndex] = kindIndexByName.shallows;
}

/**
 * The walkable tile nearest to a point of the Earth, searching outwards in
 * square rings. Throws when the region has none.
 */
export function walkableTileNearest({ grid, kinds, coordinates }) {
  const position = gridPositionOf(grid, coordinates);
  const centre = { column: Math.floor(position.column), row: Math.floor(position.row) };
  for (let ring = 0; ring < grid.columns + grid.rows; ring += 1) {
    for (let row = centre.row - ring; row <= centre.row + ring; row += 1) {
      for (let column = centre.column - ring; column <= centre.column + ring; column += 1) {
        const isOnRing = Math.max(Math.abs(row - centre.row), Math.abs(column - centre.column)) === ring;
        if (!isOnRing || column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) continue;
        if (!TILE_KINDS[kinds[row * grid.columns + column]].solid) return { column, row };
      }
    }
  }
  throw new Error('The region has no walkable tile');
}

/**
 * How much of the walkable ground can be walked to from `from` without
 * crossing a solid tile, stepping to the four neighbours: the number of
 * tiles reached and the number of walkable tiles there are.
 */
export function walkableReach({ grid, kinds, from }) {
  const isWalkable = (tileIndex) => !TILE_KINDS[kinds[tileIndex]].solid;
  const reached = new Uint8Array(kinds.length);
  const queue = [from.row * grid.columns + from.column];
  reached[queue[0]] = 1;
  let reachedCount = 0;
  while (queue.length > 0) {
    const tileIndex = queue.pop();
    reachedCount += 1;
    const column = tileIndex % grid.columns;
    const neighbours = [column > 0 ? tileIndex - 1 : -1, column < grid.columns - 1 ? tileIndex + 1 : -1, tileIndex - grid.columns, tileIndex + grid.columns];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || neighbour >= kinds.length || reached[neighbour] || !isWalkable(neighbour)) continue;
      reached[neighbour] = 1;
      queue.push(neighbour);
    }
  }
  let walkableCount = 0;
  for (let tileIndex = 0; tileIndex < kinds.length; tileIndex += 1) if (isWalkable(tileIndex)) walkableCount += 1;
  return { reachedCount, walkableCount };
}

function polygonsOf(feature) {
  if (feature.geometry?.type === 'Polygon') return [feature.geometry.coordinates];
  return feature.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
}

function linesOf(feature) {
  if (feature.geometry?.type === 'LineString') return [feature.geometry.coordinates];
  return feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [];
}
