import { describe, expect, it } from 'vitest';
import type { Command } from '../../../core/commands';
import { __testing__ } from '../../../core/create';
import { guestCharacter } from '../../../features/player/character';
import { getPlayerPosition } from '../../../features/player/queries';
import { getTileDef, TerrainDefId } from '../../../features/terrain/defs';
import { readMapTiles, tileAt, tileCentre, tileDefIdAt, WORLD_LIMIT_TILES } from '../tiles';
import type { TileCoordinate } from '../types';
import { regionMapSpawningNear, regions, tileOfCoordinates } from './index';
import type { EarthCoordinates, Region } from './types';

describe('the Alps region', () => {
  it('is a map of 896 by 640 tiles of 0.6 km that the sim can read, from Geneva to Venice', () => {
    const tiles = readMapTiles(alps.map);
    expect(tiles.bounds).toEqual({ column: 0, row: 0, width: 896, height: 640 });
    expect(alps.grid.kilometresPerTile).toBe(0.6);
    expect(tileOfCoordinates(alps, GENEVA)).toBeDefined();
    expect(tileOfCoordinates(alps, VENICE)).toBeDefined();
    expect(tileOfCoordinates(alps, GENEVA)!.column).toBeLessThan(tileOfCoordinates(alps, VENICE)!.column - 700);
  });

  it('covers the ground it says: a tile is 0.6 km tall, and 0.6 km wide at the standard parallel', () => {
    const kilometresPerDegree = (Math.PI * 6371.0088) / 180;
    expect(alps.grid.degreesPerRow * kilometresPerDegree).toBeCloseTo(0.6, 5);
    expect(alps.grid.degreesPerColumn * kilometresPerDegree * Math.cos((alps.grid.standardParallel * Math.PI) / 180)).toBeCloseTo(0.6, 5);
    // The standard parallel is the middle row, so the map is as much too wide in the north as too narrow in the south.
    expect(alps.grid.standardParallel).toBeCloseTo(alps.grid.north - 320 * alps.grid.degreesPerRow, 6);
  });

  it('names what it was made from, each with a licence and a credit line', () => {
    expect(alps.sources.map((source) => source.name)).toEqual([expect.stringContaining('Copernicus DEM'), expect.stringContaining('ESA WorldCover'), expect.stringContaining('Natural Earth')]);
    for (const source of alps.sources) expect(source.licence.length > 0 && source.credit.length > 0, source.name).toBe(true);
  });

  it('has the big lakes and both seas where they are on the Earth', () => {
    for (const [name, coordinates] of Object.entries(OPEN_WATER)) expect(kindAt(coordinates), name).toBe('water');
  });

  it('has ice or bare summit, which nobody walks on, on the highest massifs', () => {
    for (const [name, coordinates] of Object.entries(HIGH_PEAKS)) {
      const kinds = kindsWithin(coordinates, tilesIn(1.2));
      expect(kinds.has('glacier') || kinds.has('summit'), `${name}: ${[...kinds].join(', ')}`).toBe(true);
      expect(getTileDef(tileDefIdAt(readMapTiles(alps.map), tileOfCoordinates(alps, coordinates)!)!).solid, name).toBe(true);
    }
    expect(kindsWithin(ALETSCH_GLACIER, tilesIn(1.2)).has('glacier')).toBe(true);
  });

  it('has the plain of the Po as open grass, and the towns on it as the ground they stand on', () => {
    for (const [name, coordinates] of Object.entries(ON_THE_PLAIN)) expect(kindAt(coordinates), name).toBe('grass');
  });

  it('has the main rivers running through the towns they run through', () => {
    for (const [name, coordinates] of Object.entries(RIVERS_AT_TOWNS)) expect(kindsWithin(coordinates, tilesIn(2.4)).has('river'), name).toBe(true);
  });

  it('rises from the plain to the ice in bands: grass, then upland or forest, then alpine meadow or scree, going up the valley of Aosta to Mont Blanc', () => {
    expect(kindsWithin({ latitude: 45.2, longitude: 8.0 }, tilesIn(1.2)).has('grass')).toBe(true);
    const kindsUpTheValley = new Set(Array.from({ length: 40 }, (_, step) => kindAt({ latitude: 45.45 + (step * 0.38) / 40, longitude: 7.87 - (step * 1.0) / 40 })));
    for (const kind of ['mountain forest', 'alpine meadow', 'scree']) expect(kindsUpTheValley.has(kind), `${kind} in ${[...kindsUpTheValley].join(', ')}`).toBe(true);
  });

  it('keeps deep water away from the land: every lake and coast is ringed by shallows, where the coast is drawn', () => {
    const tiles = readMapTiles(alps.map);
    const isWater = (defId: number | undefined) => defId === undefined || defId === TerrainDefId.Water || defId === TerrainDefId.Shallows;
    let deepTiles = 0;
    for (let row = 0; row < tiles.bounds.height; row += 1) {
      for (let column = 0; column < tiles.bounds.width; column += 1) {
        if (tileDefIdAt(tiles, { column, row }) !== TerrainDefId.Water) continue;
        deepTiles += 1;
        for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
          for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) expect(isWater(tileDefIdAt(tiles, { column: column + columnOffset, row: row + rowOffset })), `(${column}, ${row})`).toBe(true);
        }
      }
    }
    expect(deepTiles).toBeGreaterThan(4000);
  });

  it('can be walked: from the spawn, all but a few pockets of the walkable ground are reached without crossing water, ice or summit', () => {
    const { reachedCount, walkableCount, isReached } = reachFrom(alps.map.spawn);
    expect(reachedCount / walkableCount).toBeGreaterThan(0.99);
    // The walk the region is named for exists, over the passes or around the lakes: from Geneva to the shore of the lagoon.
    for (const [name, town] of Object.entries({ GENEVA, MESTRE, MILAN, INNSBRUCK })) expect(isReached(regionMapSpawningNear(alps, town).spawn), name).toBe(true);
    // Venice itself is one of the pockets, as it should be: islands in the lagoon, and nobody swims.
    expect(isReached(regionMapSpawningNear(alps, VENICE).spawn)).toBe(false);
  });

  it('stays inside the limit of the world', () => {
    expect(Math.max(readMapTiles(alps.map).bounds.width, readMapTiles(alps.map).bounds.height)).toBeLessThan(WORLD_LIMIT_TILES);
  });
});

describe('walking a region', () => {
  it('lets a player wade across a river and stops them at the shore of a lake', async () => {
    const riverTile = riverTileWithGroundNorthAndSouth();
    const wading = await createSimInternal({ seed: 1, map: { areas: alps.map.areas, spawn: { column: riverTile.column, row: riverTile.row - 1 } } });
    wading.step([join]);
    for (let tick = 0; tick < 60; tick += 1) wading.step([{ type: 'player/move', slot: 0, x: 0, y: 1 }]);
    expect(tileAt(...positionOfThePlayer(wading))!.row).toBeGreaterThan(riverTile.row);

    const shoreTile = groundTileWithLakeToTheSouth();
    const stopped = await createSimInternal({ seed: 1, map: { areas: alps.map.areas, spawn: shoreTile } });
    stopped.step([join]);
    for (let tick = 0; tick < 120; tick += 1) stopped.step([{ type: 'player/move', slot: 0, x: 0, y: 1 }]);
    expect(tileAt(...positionOfThePlayer(stopped))).toEqual(shoreTile);
    expect(positionOfThePlayer(stopped)[1]).toBeGreaterThan(tileCentre(shoreTile).y);
  });
});

describe('tileOfCoordinates', () => {
  it('finds the tile a latitude and a longitude fall in, counting columns east from the west edge and rows south from the north edge', () => {
    const { north, west, degreesPerColumn, degreesPerRow } = alps.grid;
    expect(tileOfCoordinates(alps, { latitude: north - degreesPerRow / 2, longitude: west + degreesPerColumn / 2 })).toEqual({ column: 0, row: 0 });
    expect(tileOfCoordinates(alps, { latitude: north - 10.5 * degreesPerRow, longitude: west + 20.5 * degreesPerColumn })).toEqual({ column: 20, row: 10 });
  });

  it('answers undefined outside the region and for numbers that are not a place', () => {
    const { north, west } = alps.grid;
    for (const coordinates of [{ latitude: north + 0.01, longitude: west + 1 }, { latitude: north - 1, longitude: west - 0.01 }, { latitude: 0, longitude: 0 }, { latitude: Number.NaN, longitude: 8 }, { latitude: 46, longitude: Number.POSITIVE_INFINITY }]) {
      expect(tileOfCoordinates(alps, coordinates), JSON.stringify(coordinates)).toBeUndefined();
    }
  });
});

describe('regionMapSpawningNear', () => {
  it('moves the spawn to the walkable tile nearest to a place and leaves the region itself as it was', () => {
    const map = regionMapSpawningNear(alps, MILAN);
    expect(map.spawn).toEqual(tileOfCoordinates(alps, MILAN));
    expect(map.areas).toBe(alps.map.areas);
    const fromTheLake = regionMapSpawningNear(alps, OPEN_WATER['Lake Garda']!);
    expect(getTileDef(tileDefIdAt(readMapTiles(fromTheLake), fromTheLake.spawn)!).solid).toBe(false);
    expect(alps.map.spawn).toEqual(regions.alps!.map.spawn);
  });

  it('throws for a place outside the region', () => {
    expect(() => regionMapSpawningNear(alps, { latitude: 40, longitude: 8 })).toThrow(/outside the region "alps"/);
  });
});

// ---- Helpers ----

const { createSimInternal } = __testing__;
const alps = regions.alps as Region;
const join: Command = { type: 'player/join', slot: 0, character: guestCharacter(0) };

// Places as an atlas gives them, in degrees. Nothing here is read from the region.
const GENEVA: EarthCoordinates = { latitude: 46.2, longitude: 6.15 };
const VENICE: EarthCoordinates = { latitude: 45.44, longitude: 12.33 };
const MILAN: EarthCoordinates = { latitude: 45.46, longitude: 9.19 };
const INNSBRUCK: EarthCoordinates = { latitude: 47.27, longitude: 11.39 };
/** Konkordiaplatz, where the branches of the Aletsch glacier meet. */
const ALETSCH_GLACIER: EarthCoordinates = { latitude: 46.5, longitude: 8.03 };
/** The shore of the lagoon facing Venice. */
const MESTRE: EarthCoordinates = { latitude: 45.49, longitude: 12.24 };

const OPEN_WATER: Record<string, EarthCoordinates> = {
  'Lake Geneva': { latitude: 46.45, longitude: 6.55 },
  'Lake Neuchâtel': { latitude: 46.9, longitude: 6.85 },
  'Lake Constance': { latitude: 47.6, longitude: 9.45 },
  'Lake Zurich': { latitude: 47.25, longitude: 8.65 },
  'Lake Maggiore': { latitude: 45.95, longitude: 8.63 },
  'Lake Como': { latitude: 46.03, longitude: 9.27 },
  'Lake Garda': { latitude: 45.6, longitude: 10.63 },
  'the Adriatic off Venice': { latitude: 45.3, longitude: 12.6 },
  'the Gulf of Genoa': { latitude: 44.33, longitude: 8.95 },
};

const HIGH_PEAKS: Record<string, EarthCoordinates> = {
  'Mont Blanc': { latitude: 45.833, longitude: 6.865 },
  'Monte Rosa': { latitude: 45.937, longitude: 7.867 },
  'Piz Bernina': { latitude: 46.382, longitude: 9.908 },
  Ortler: { latitude: 46.509, longitude: 10.545 },
  Grossglockner: { latitude: 47.074, longitude: 12.694 },
};

const ON_THE_PLAIN: Record<string, EarthCoordinates> = {
  Milan: MILAN,
  Turin: { latitude: 45.07, longitude: 7.69 },
  'the plain south of Lake Garda': { latitude: 45.2, longitude: 10.5 },
};

const RIVERS_AT_TOWNS: Record<string, EarthCoordinates> = {
  'the Po at Piacenza': { latitude: 45.06, longitude: 9.7 },
  'the Po at Turin': { latitude: 45.06, longitude: 7.7 },
  'the Rhône at Sion': { latitude: 46.23, longitude: 7.36 },
  'the Rhine at Chur': { latitude: 46.85, longitude: 9.52 },
  'the Inn at Innsbruck': INNSBRUCK,
  'the Adige at Trento': { latitude: 46.07, longitude: 11.11 },
  'the Adige at Verona': { latitude: 45.44, longitude: 10.99 },
  'the Aare at Bern': { latitude: 46.95, longitude: 7.45 },
  'the Adda at Sondrio': { latitude: 46.17, longitude: 9.87 },
  'the Ticino at Pavia': { latitude: 45.18, longitude: 9.15 },
};

/** How many tiles cover a distance on the ground: a town is not a point, so places are looked for within a distance, whatever the scale. */
function tilesIn(kilometres: number): number {
  return Math.round(kilometres / alps.grid.kilometresPerTile);
}

/** The name of the tile def at a place, with the shallows counted as the water they ring. */
function kindAt(coordinates: EarthCoordinates): string {
  const tile = tileOfCoordinates(alps, coordinates);
  if (!tile) throw new Error(`(${coordinates.latitude}, ${coordinates.longitude}) is outside the region`);
  return kindOfTile(tile) as string;
}

function kindOfTile(tile: TileCoordinate): string | undefined {
  const defId = tileDefIdAt(readMapTiles(alps.map), tile);
  if (defId === undefined) return undefined;
  return defId === TerrainDefId.Shallows ? 'water' : getTileDef(defId).name;
}

/** The kinds of the tiles within `radius` tiles of a place: a town is not a point, and a line drawn a tile wide may run beside it. */
function kindsWithin(coordinates: EarthCoordinates, radius: number): Set<string> {
  const centre = tileOfCoordinates(alps, coordinates);
  if (!centre) throw new Error(`(${coordinates.latitude}, ${coordinates.longitude}) is outside the region`);
  const kinds = new Set<string>();
  for (let row = centre.row - radius; row <= centre.row + radius; row += 1) {
    for (let column = centre.column - radius; column <= centre.column + radius; column += 1) {
      const kind = kindOfTile({ column, row });
      if (kind) kinds.add(kind);
    }
  }
  return kinds;
}

function isWalkable(tile: TileCoordinate): boolean {
  const defId = tileDefIdAt(readMapTiles(alps.map), tile);
  return defId !== undefined && !getTileDef(defId).solid;
}

/** What a walker starting on `from` can get to, stepping to the four neighbours over walkable tiles only. */
function reachFrom(from: TileCoordinate): { reachedCount: number; walkableCount: number; isReached(tile: TileCoordinate): boolean } {
  const { width, height } = readMapTiles(alps.map).bounds;
  const reached = new Uint8Array(width * height);
  const queue = [from];
  reached[from.row * width + from.column] = 1;
  let reachedCount = 0;
  for (let tile = queue.pop(); tile; tile = queue.pop()) {
    reachedCount += 1;
    for (const [columnOffset, rowOffset] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const neighbour = { column: tile.column + columnOffset, row: tile.row + rowOffset };
      if (neighbour.column < 0 || neighbour.column >= width || neighbour.row < 0 || neighbour.row >= height) continue;
      if (reached[neighbour.row * width + neighbour.column] || !isWalkable(neighbour)) continue;
      reached[neighbour.row * width + neighbour.column] = 1;
      queue.push(neighbour);
    }
  }
  let walkableCount = 0;
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) if (isWalkable({ column, row })) walkableCount += 1;
  return { reachedCount, walkableCount, isReached: (tile) => reached[tile.row * width + tile.column] === 1 };
}

/** A river tile with two walkable tiles that are not river north of it and two south, so a walk south crosses the river and nothing else. */
function riverTileWithGroundNorthAndSouth(): TileCoordinate {
  const tiles = readMapTiles(alps.map);
  const isGround = (tile: TileCoordinate) => isWalkable(tile) && tileDefIdAt(tiles, tile) !== TerrainDefId.River;
  for (let row = 2; row < tiles.bounds.height - 2; row += 1) {
    for (let column = 0; column < tiles.bounds.width; column += 1) {
      if (tileDefIdAt(tiles, { column, row }) !== TerrainDefId.River) continue;
      if ([-2, -1, 1, 2].every((rowOffset) => isGround({ column, row: row + rowOffset }))) return { column, row };
    }
  }
  throw new Error('No river of the region runs east to west with ground on both banks');
}

/** A walkable tile with the shallows of a lake directly south of it. */
function groundTileWithLakeToTheSouth(): TileCoordinate {
  const tiles = readMapTiles(alps.map);
  const lake = tileOfCoordinates(alps, OPEN_WATER['Lake Geneva']!)!;
  for (let row = lake.row; row > 0; row -= 1) {
    if (isWalkable({ column: lake.column, row })) {
      expect(tileDefIdAt(tiles, { column: lake.column, row: row + 1 })).toBe(TerrainDefId.Shallows);
      return { column: lake.column, row };
    }
  }
  throw new Error('No shore north of the middle of Lake Geneva');
}

function positionOfThePlayer(sim: Awaited<ReturnType<typeof createSimInternal>>): [number, number] {
  const position = getPlayerPosition(sim, 0);
  if (!position) throw new Error('No player in seat 0');
  return [position.x, position.y];
}
