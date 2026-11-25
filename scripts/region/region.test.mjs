import { regions, terrainDefs } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { boundsOfGrid, gridOfRegion, gridPositionOf } from './projection.mjs';
import { alps } from './regions/alps.mjs';
import { addElevationSample, addLandCoverSample, drawRivers, emptyTallies, fillLakes, kindsFromTallies, ringWaterWithShallows, riverPoolsToRiver, tallyRaster, walkableReach, walkableTileNearest } from './regionTiles.mjs';
import { isInsidePolygon, tilesAlongSegment } from './shapes.mjs';
import { elevationSource, filesCovering, LandCover, landCoverSource } from './sources.mjs';
import { __testing__, COVER_GROUPS, kindIndexByName, kindOfTile, riverWidthInTiles, TILE_KINDS } from './tileKinds.mjs';
import { regionModuleText } from './writeRegion.mjs';

describe('gridOfRegion', () => {
  it('makes a tile as tall as asked everywhere and as wide as asked at the middle latitude', () => {
    const grid = gridOfRegion(alps);
    const { north, south } = boundsOfGrid(grid);
    expect(kilometresBetween({ latitude: north, longitude: 8 }, { latitude: north - grid.degreesPerRow, longitude: 8 })).toBeCloseTo(0.6, 4);
    expect(grid.standardParallel).toBeCloseTo((north + south) / 2, 6);
    expect(kilometresBetween({ latitude: grid.standardParallel, longitude: 8 }, { latitude: grid.standardParallel, longitude: 8 + grid.degreesPerColumn })).toBeCloseTo(0.6, 4);
    // At the north edge the same step of longitude covers less ground, at the south edge more: about three percent each way.
    expect(kilometresBetween({ latitude: north, longitude: 8 }, { latitude: north, longitude: 8 + grid.degreesPerColumn })).toBeCloseTo(0.6 * 0.968, 2);
    expect(kilometresBetween({ latitude: south, longitude: 8 }, { latitude: south, longitude: 8 + grid.degreesPerColumn })).toBeCloseTo(0.6 * 1.031, 2);
  });

  it('places a point of the Earth in tiles and fractions of a tile, columns east from the west edge and rows south from the north edge', () => {
    const grid = gridOfRegion({ kilometresPerTile: 1.2, columns: 10, rows: 5, north: 46, west: 8 });
    expect(gridPositionOf(grid, { latitude: 46, longitude: 8 })).toEqual({ column: 0, row: 0 });
    expect(gridPositionOf(grid, { latitude: 46 - grid.degreesPerRow * 1.5, longitude: 8 + grid.degreesPerColumn * 2.25 })).toEqual({ column: expect.closeTo(2.25, 6), row: expect.closeTo(1.5, 6) });
    expect(gridPositionOf(grid, { latitude: 46.5, longitude: 7 }).row).toBeLessThan(0);
  });

  it('is the grid the committed region was written with', () => {
    const { columns, rows, ...grid } = gridOfRegion(alps);
    expect(regions.alps.grid).toEqual(grid);
    expect(regions.alps.map.areas[0].rows).toHaveLength(rows);
    expect(regions.alps.map.areas[0].rows[0]).toHaveLength(columns);
  });
});

describe('the sources', () => {
  it('names the files that touch a region the way each dataset does', () => {
    const bounds = { north: 47.75, south: 44.3, west: 5.85, east: 12.81 };
    const elevationFiles = filesCovering(elevationSource, bounds);
    expect(elevationFiles).toHaveLength(4 * 8);
    expect(elevationSource.urlOfFile({ south: 46, west: 7 })).toBe('https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_N46_00_E007_00_DEM/Copernicus_DSM_COG_30_N46_00_E007_00_DEM.tif');
    expect(elevationSource.urlOfFile({ south: -3, west: -70 })).toContain('_S03_00_W070_00_DEM');
    expect(filesCovering(landCoverSource, bounds)).toEqual([3, 6, 9, 12].map((west) => ({ south: 42, west })).concat([3, 6, 9, 12].map((west) => ({ south: 45, west }))));
    expect(landCoverSource.urlOfFile({ south: 45, west: 6 })).toBe('https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N45E006_Map.tif');
  });
});

describe('kindOfTile', () => {
  it('lets the most common land cover decide, and reads height as bands', () => {
    expect(kindOfTile({ coverCounts: cover({ open: 5, trees: 4 }), meanElevation: 120 })).toBe('grass');
    expect(kindOfTile({ coverCounts: cover({ open: 5, trees: 4 }), meanElevation: HeightBand.Upland })).toBe('upland');
    expect(kindOfTile({ coverCounts: cover({ open: 5 }), meanElevation: HeightBand.AlpineMeadow })).toBe('alpineMeadow');
    expect(kindOfTile({ coverCounts: cover({ open: 5 }), meanElevation: HeightBand.Scree })).toBe('scree');
    expect(kindOfTile({ coverCounts: cover({ trees: 5, open: 4 }), meanElevation: 300 })).toBe('forest');
    expect(kindOfTile({ coverCounts: cover({ trees: 5, open: 4 }), meanElevation: HeightBand.MountainForest })).toBe('mountainForest');
    expect(kindOfTile({ coverCounts: cover({ bare: 5, open: 4 }), meanElevation: 2000 })).toBe('scree');
    expect(kindOfTile({ coverCounts: cover({ wetland: 5, open: 4 }), meanElevation: 2 })).toBe('marsh');
  });

  it('puts water and ice before height, and summit before whatever grows up there', () => {
    expect(kindOfTile({ coverCounts: cover({ water: 5, open: 4 }), meanElevation: 3000 })).toBe('water');
    expect(kindOfTile({ coverCounts: cover({ snowAndIce: 5, bare: 4 }), meanElevation: 2500 })).toBe('glacier');
    for (const group of ['open', 'trees', 'bare', 'wetland']) expect(kindOfTile({ coverCounts: cover({ [group]: 5 }), meanElevation: HeightBand.Summit }), group).toBe('summit');
    expect(kindOfTile({ coverCounts: cover({ bare: 5 }), meanElevation: HeightBand.Summit - 1 })).toBe('scree');
  });

  it('takes a tile no sample fell in for open sea, and gives a tie to water first', () => {
    expect(kindOfTile({ coverCounts: cover({}), meanElevation: 0 })).toBe('water');
    expect(kindOfTile({ coverCounts: cover({ water: 3, open: 3 }), meanElevation: 100 })).toBe('water');
  });
});

describe('the kinds of tile', () => {
  it('each name a tile def of the sim, with the same answer to whether a player walks on it, under a character of its own', () => {
    for (const kind of TILE_KINDS) {
      const def = terrainDefs.find((candidate) => candidate.name === kind.defName.replace(/(?<!^)[A-Z]/g, (capital) => ` ${capital}`).toLowerCase());
      expect(def, kind.name).toBeDefined();
      expect(def.solid, kind.name).toBe(kind.solid);
      expect(kind.character, kind.name).toHaveLength(1);
    }
    expect(new Set(TILE_KINDS.map((kind) => kind.character)).size).toBe(TILE_KINDS.length);
  });
});

describe('tallyRaster', () => {
  it('adds each sample of a file to the tile it falls in and leaves out the samples outside the grid', () => {
    // A grid of 2 by 2 tiles of exactly half a degree, inside a file of one degree whose south-west corner is (45, 7).
    const grid = { columns: 2, rows: 2, north: 46, west: 7.5, degreesPerColumn: 0.25, degreesPerRow: 0.25 };
    const tallies = emptyTallies(grid);
    // 4 by 4 samples, a quarter of a degree each: the grid is the two right columns of the two top rows.
    const elevation = { width: 4, height: 4, samples: Float32Array.from([0, 0, 100, 200, 0, 0, 300, 400, 9, 9, 9, 9, 9, 9, 9, 9]) };
    tallyRaster({ grid, file: { south: 45, west: 7 }, degreesPerFile: 1, raster: elevation, addSample: addElevationSample(tallies) });
    expect([...tallies.elevationSum]).toEqual([100, 200, 300, 400]);
    expect([...tallies.elevationSamples]).toEqual([1, 1, 1, 1]);
    const landCover = { width: 4, height: 4, samples: Uint8Array.from([0, 0, LandCover.Trees, LandCover.Water, 0, 0, LandCover.Cropland, 255, 0, 0, 0, 0, 0, 0, 0, 0]) };
    tallyRaster({ grid, file: { south: 45, west: 7 }, degreesPerFile: 1, raster: landCover, addSample: addLandCoverSample(tallies) });
    expect([...kindsFromTallies(grid, tallies)].map((kind) => TILE_KINDS[kind].name)).toEqual(['forest', 'water', 'grass', 'water']);
  });
});

describe('tilesAlongSegment', () => {
  it('lists every tile a line crosses, both ends included, each sharing a side with the next', () => {
    expect(tilesAlongSegment({ column: 0.5, row: 0.5 }, { column: 3.5, row: 0.5 })).toEqual([0, 1, 2, 3].map((column) => ({ column, row: 0 })));
    expect(tilesAlongSegment({ column: 2.2, row: 3.9 }, { column: 2.8, row: 3.1 })).toEqual([{ column: 2, row: 3 }]);
    // A shallow diagonal stays beside the line: it never runs along one axis and then the other.
    expect(tilesAlongSegment({ column: 0.5, row: 0.5 }, { column: 4.5, row: 2.5 })).toEqual([[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 2], [4, 2]].map(([column, row]) => ({ column, row })));
    for (const [from, to] of [[{ column: 0.5, row: 0.5 }, { column: 5.5, row: 5.5 }], [{ column: 7.9, row: 1.1 }, { column: -2.3, row: 4.7 }], [{ column: 3.2, row: 9.9 }, { column: 3.9, row: -4.1 }], [{ column: -1.5, row: -1.5 }, { column: 6.25, row: 2.75 }]]) {
      const tiles = tilesAlongSegment(from, to);
      expect(tiles[0]).toEqual({ column: Math.floor(from.column), row: Math.floor(from.row) });
      expect(tiles.at(-1)).toEqual({ column: Math.floor(to.column), row: Math.floor(to.row) });
      for (let index = 1; index < tiles.length; index += 1) expect(Math.abs(tiles[index].column - tiles[index - 1].column) + Math.abs(tiles[index].row - tiles[index - 1].row)).toBe(1);
    }
  });
});

describe('isInsidePolygon', () => {
  it('counts a point in a hole as outside', () => {
    const square = (from, to) => [{ column: from, row: from }, { column: to, row: from }, { column: to, row: to }, { column: from, row: to }, { column: from, row: from }];
    const rings = [square(0, 10), square(4, 6)];
    expect(isInsidePolygon(rings, { column: 2, row: 2 })).toBe(true);
    expect(isInsidePolygon(rings, { column: 5, row: 5 })).toBe(false);
    expect(isInsidePolygon(rings, { column: 11, row: 5 })).toBe(false);
  });
});

describe('the water of a region', () => {
  it('fills a lake from its outline, draws a river a tile wide over ground only, and rings the water with shallows', () => {
    const grid = { columns: 8, rows: 6, north: 6, west: 0, degreesPerColumn: 1, degreesPerRow: 1 };
    const kinds = new Uint8Array(grid.columns * grid.rows).fill(kindIndexByName.grass);
    kinds[0] = kindIndexByName.glacier;
    // A lake over the columns 4 to 6 and the rows 1 to 3 (latitudes 5 down to 2).
    const lake = { geometry: { type: 'Polygon', coordinates: [[[4, 5], [7, 5], [7, 2], [4, 2], [4, 5]]] } };
    expect(fillLakes({ grid, kinds, lakes: [lake] })).toBe(9);
    // A river along the top row from the glacier, then down the first column, then east along row 2 into the lake.
    const river = { properties: { name: 'Test' }, geometry: { type: 'MultiLineString', coordinates: [[[0.5, 5.5], [2.5, 5.5]], [[2.5, 5.5], [2.5, 3.5], [5.5, 3.5]]] } };
    const elsewhere = { properties: {}, geometry: { type: 'LineString', coordinates: [[100, 50], [101, 51]] } };
    // A line with a point that is nowhere on the Earth is left out whole instead of being walked to the end of the numbers.
    const broken = { properties: { name: 'Broken' }, geometry: { type: 'LineString', coordinates: [[1.5, 0.5], [1e300, 0.5]] } };
    expect(drawRivers({ grid, kinds, rivers: [river, elsewhere, broken] })).toEqual({ Test: 5 });
    ringWaterWithShallows({ grid, kinds });
    expect(rowsOf(grid, kinds)).toEqual(['Grr.....', '..r.---.', '..rr-~-.', '....---.', '........', '........']);
  });

  it('draws a river two or three tiles wide when Natural Earth ranks it as important, and never over a lake, ice or the edge of the map', () => {
    expect([undefined, 11, 10, 9, 7, 6, 4].map(riverWidthInTiles)).toEqual([1, 1, 1, 2, 2, 3, 3]);
    const grid = { columns: 7, rows: 5, north: 5, west: 0, degreesPerColumn: 1, degreesPerRow: 1 };
    const along = (scalerank, latitude) => ({ properties: { name: `rank ${scalerank}`, scalerank }, geometry: { type: 'LineString', coordinates: [[0.5, latitude], [6.5, latitude]] } });
    const great = new Uint8Array(grid.columns * grid.rows).fill(kindIndexByName.grass);
    great[2 * grid.columns + 3] = kindIndexByName.glacier;
    // Rank 6 along the middle row: the row itself and one each side, but not the ice in its way.
    expect(drawRivers({ grid, kinds: great, rivers: [along(6, 2.5)] })).toEqual({ 'rank 6': 20 });
    expect(rowsOf(grid, great)).toEqual(['.......', 'rrrrrrr', 'rrrGrrr', 'rrrrrrr', '.......']);
    // Rank 8 along the top row: an even width leans south, so the row itself and the one south of it.
    const main = new Uint8Array(grid.columns * grid.rows).fill(kindIndexByName.grass);
    expect(drawRivers({ grid, kinds: main, rivers: [along(8, 4.5)] })).toEqual({ 'rank 8': 14 });
    expect(rowsOf(grid, main)).toEqual(['rrrrrrr', 'rrrrrrr', '.......', '.......', '.......']);
    // Rank 6 along the top row and down the last column: the rows north of the map and the columns east of it do not exist.
    const corner = new Uint8Array(grid.columns * grid.rows).fill(kindIndexByName.grass);
    const aroundTheCorner = { properties: { name: 'corner', scalerank: 6 }, geometry: { type: 'LineString', coordinates: [[0.5, 4.5], [6.5, 4.5], [6.5, 0.5]] } };
    expect(drawRivers({ grid, kinds: corner, rivers: [aroundTheCorner] })).toEqual({ corner: 20 });
    expect(rowsOf(grid, corner)).toEqual(['rrrrrrr', 'rrrrrrr', '.....rr', '.....rr', '.....rr']);
  });

  it('makes the water a river shows of itself part of the river, and leaves a lake on the river and a pond away from it as they are', () => {
    const grid = { columns: 12, rows: 7, north: 7, west: 0, degreesPerColumn: 1, degreesPerRow: 1 };
    const before = ['............', '.~......~~~~', 'rr~~rrrr~~~~', '.~.~....~~~~', '...~....~~~~', '.......~~~~.', '...........~', 'r...........'];
    const tall = { ...grid, rows: before.length };
    const kinds = Uint8Array.from(before.join(''), (character) => TILE_KINDS.findIndex((kind) => kind.character === character));
    // The two single tiles beside the river's line become river. The pond in the line stays whole, because its far end
    // touches no river; so does the lake the river runs into; and so does the tile at the end of a row, which is beside
    // the river at the start of the next row only in the array.
    expect(riverPoolsToRiver({ grid: tall, kinds })).toBe(2);
    expect(rowsOf(tall, kinds)).toEqual(['............', '.r......~~~~', 'rr~~rrrr~~~~', '.r.~....~~~~', '...~....~~~~', '.......~~~~.', '...........~', 'r...........']);
  });

  it('leaves the sea deep where it runs off the map', () => {
    const grid = { columns: 4, rows: 3, north: 3, west: 0, degreesPerColumn: 1, degreesPerRow: 1 };
    const kinds = Uint8Array.from('..~~..~~..~~', (character) => TILE_KINDS.findIndex((kind) => kind.character === character));
    ringWaterWithShallows({ grid, kinds });
    expect(rowsOf(grid, kinds)).toEqual(['..-~', '..-~', '..-~']);
  });
});

describe('the spawn of a region', () => {
  it('is the walkable tile nearest to the place asked for, and the reach from it stops at solid tiles', () => {
    const grid = { columns: 5, rows: 3, north: 3, west: 0, degreesPerColumn: 1, degreesPerRow: 1 };
    const kinds = Uint8Array.from('~~~G.' + '~~~G.' + '..~G.', (character) => TILE_KINDS.findIndex((kind) => kind.character === character));
    const spawn = walkableTileNearest({ grid, kinds, coordinates: { latitude: 2.5, longitude: 0.5 } });
    expect(spawn).toEqual({ column: 0, row: 2 });
    expect(walkableReach({ grid, kinds, from: spawn })).toEqual({ reachedCount: 2, walkableCount: 5 });
    expect(() => walkableTileNearest({ grid, kinds: new Uint8Array(15).fill(kindIndexByName.water), coordinates: { latitude: 1, longitude: 1 } })).toThrow(/no walkable tile/);
  });
});

describe('regionModuleText', () => {
  it('writes the rows, a legend of the kinds used, the grid, the spawn and the credit of every source', () => {
    const text = regionModuleText({
      name: 'tiny',
      grid: { north: 46, west: 8, degreesPerColumn: 0.015, degreesPerRow: 0.01, standardParallel: 45.9, kilometresPerTile: 1.2 },
      rows: ['.~', 'r.'],
      spawn: { column: 1, row: 1 },
      kinds: TILE_KINDS.filter((kind) => ['grass', 'water', 'river'].includes(kind.name)),
      sources: [{ name: 'A "quoted" source', licence: 'CC BY 4.0', credit: '© Someone' }],
    });
    expect(text).toContain('export const tiny: Region = {');
    expect(text).toContain('legend: { ".": TerrainDefId.Grass, "r": TerrainDefId.River, "~": TerrainDefId.Water },');
    expect(text).toContain('          ".~",\n          "r.",\n');
    expect(text).toContain('spawn: { column: 1, row: 1 },');
    expect(text).toContain('{ name: "A \\"quoted\\" source", licence: "CC BY 4.0", credit: "© Someone" },');
    expect(text).toContain('// - A "quoted" source. CC BY 4.0. © Someone.');
  });
});

// ---- Helpers ----

const { HeightBand } = __testing__;

function cover(counts) {
  return COVER_GROUPS.map((group) => counts[group] ?? 0);
}

function rowsOf(grid, kinds) {
  return Array.from({ length: grid.rows }, (_, row) => Array.from(kinds.subarray(row * grid.columns, (row + 1) * grid.columns), (kind) => TILE_KINDS[kind].character).join(''));
}

/** The distance over the ground between two points of the Earth, by the haversine formula: a second opinion on the grid's arithmetic. */
function kilometresBetween(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const halfChord = Math.sin(radians(second.latitude - first.latitude) / 2) ** 2 + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(radians(second.longitude - first.longitude) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(halfChord));
}
