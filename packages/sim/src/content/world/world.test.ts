import { describe, expect, it } from 'vitest';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import { __testing__ as physicsTesting } from '../../core/physics';
import { getRenderables } from '../../core/view';
import { findPlayerEntity } from '../../features/player/queries';
import { getTileDef, terrainDefs, TerrainDefId, TILE_SIZE } from '../../features/terrain/defs';
import { DefId } from '../defs';
import { generatedWorldMap } from './generated';
import { worldMap } from './index';
import { __testing__ as tilesTesting, CHUNK_SIZE, chunkCoordinateOf, findChunk, NO_TILE, readMapTiles, spawnPoint, tileAt, tileCentre, tileDefIdAt, WORLD_LIMIT_TILES } from './tiles';
import type { AreaData, TileCoordinate, WorldMap } from './types';

describe('reading a map into chunks', () => {
  it('resolves an area\'s ASCII rows through its legend into tile def ids at the world tiles it reserves', () => {
    const tiles = readMapTiles(mapOf([area(['TTT', 'T.T', 'T=T'], { column: 5, row: -2 })], { column: 6, row: -1 }));
    expect(tiles).toMatchObject({ tileSize: TILE_SIZE, chunkSize: CHUNK_SIZE, bounds: { column: 5, row: -2, width: 3, height: 3 } });
    expect([-2, -1, 0].map((row) => [5, 6, 7].map((column) => tileDefIdAt(tiles, { column, row })))).toEqual([
      [DefId.Tree, DefId.Tree, DefId.Tree],
      [DefId.Tree, DefId.Grass, DefId.Tree],
      [DefId.Tree, DefId.Dirt, DefId.Tree],
    ]);
    // No area put a tile next to it.
    for (const tile of [{ column: 4, row: -2 }, { column: 8, row: 0 }, { column: 5, row: 1 }, { column: 5, row: -3 }, { column: 900, row: 900 }]) {
      expect(tileDefIdAt(tiles, tile), JSON.stringify(tile)).toBeUndefined();
    }
    expect(tileDefIdAt(tiles, { column: 5.5, row: -2 })).toBeUndefined();
  });

  it('stores tiles in chunks of CHUNK_SIZE, top row first then left to right, and only the chunks that hold a tile', () => {
    // Two tiles wide across the column-0 chunk edge, two tiles tall across the row-0 edge: four chunks.
    const tiles = readMapTiles(mapOf([area(['..', '..'], { column: -1, row: -1 })], { column: 0, row: 0 }));
    expect(tiles.chunks.map(({ column, row, firstTile }) => ({ column, row, firstTile }))).toEqual([
      { column: -1, row: -1, firstTile: { column: -CHUNK_SIZE, row: -CHUNK_SIZE } },
      { column: 0, row: -1, firstTile: { column: 0, row: -CHUNK_SIZE } },
      { column: -1, row: 0, firstTile: { column: -CHUNK_SIZE, row: 0 } },
      { column: 0, row: 0, firstTile: { column: 0, row: 0 } },
    ]);
    for (const chunk of tiles.chunks) {
      expect(chunk.defIds).toHaveLength(CHUNK_SIZE * CHUNK_SIZE);
      expect(chunk.defIds.filter((defId) => defId !== NO_TILE)).toHaveLength(1);
      expect(findChunk(tiles, chunk)).toBe(chunk);
    }
    expect(findChunk(tiles, { column: 1, row: 0 })).toBeUndefined();
    expect(chunkCoordinateOf({ column: -1, row: CHUNK_SIZE })).toEqual({ column: -1, row: 1 });
    expect(chunkCoordinateOf({ column: CHUNK_SIZE - 1, row: -CHUNK_SIZE })).toEqual({ column: 0, row: -1 });
  });

  it('converts between tiles and metres with no map at all: tile (0, 0) has its corner on the origin', () => {
    expect(tileCentre({ column: 0, row: 0 })).toEqual({ x: 0.5 * TILE_SIZE, y: 0.5 * TILE_SIZE });
    expect(tileCentre({ column: -3, row: 7 })).toEqual({ x: -2.5 * TILE_SIZE, y: 7.5 * TILE_SIZE });
    expect(tileAt(0, 0)).toEqual({ column: 0, row: 0 });
    expect(tileAt(-0.01, 2.99 * TILE_SIZE)).toEqual({ column: -1, row: 2 });
    expect(tileAt(Number.NaN, 0)).toBeUndefined();
    expect(tileAt(0, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('rejects ragged rows, unknown characters, non-tile defs, bad origins and spawns off every area or on a solid tile', () => {
    const spawn = { column: 1, row: 0 };
    expect(() => readMapTiles(mapOf([area(['TTT', 'TT'])], spawn))).toThrow(/Area "test": row 1 has 2 tiles, expected 3/);
    expect(() => readMapTiles(mapOf([area(['T?T'])], spawn))).toThrow(/no legend entry for "\?"/);
    expect(() => readMapTiles(mapOf([{ ...area(['T.']), legend: { T: DefId.PlayerSky } }], spawn))).toThrow(/not a tile/);
    expect(() => readMapTiles(mapOf([{ ...area(['T.']), legend: { TT: DefId.Tree } }], spawn))).toThrow(/one character/);
    expect(() => readMapTiles(mapOf([area([])], spawn))).toThrow(/no rows/);
    expect(() => readMapTiles(mapOf([area([''])], spawn))).toThrow(/empty rows/);
    expect(() => readMapTiles(mapOf([], spawn))).toThrow(/no areas/);
    expect(() => readMapTiles(mapOf([area(['T.'], { column: 0.5, row: 0 })], spawn))).toThrow(/origin \(0.5, 0\) is not a tile/);
    expect(() => readMapTiles(mapOf([area(['T.'], { column: 0, row: Number.NaN })], spawn))).toThrow(/is not a tile/);
    expect(() => readMapTiles(mapOf([area(['T.'], { column: WORLD_LIMIT_TILES - 1, row: 0 })], spawn))).toThrow(/reaches further than/);
    expect(() => readMapTiles(mapOf([area(['T.'], { column: 0, row: -WORLD_LIMIT_TILES - 1 })], spawn))).toThrow(/reaches further than/);
    expect(() => readMapTiles(mapOf([area(['T.'], { column: -WORLD_LIMIT_TILES, row: WORLD_LIMIT_TILES - 1 })], { column: 1 - WORLD_LIMIT_TILES, row: WORLD_LIMIT_TILES - 1 }))).not.toThrow();
    expect(() => readMapTiles(mapOf([area(['T.'])], { column: 2, row: 0 }))).toThrow(/not on a tile of any area/);
    expect(() => readMapTiles(mapOf([area(['T.'])], { column: 0.5, row: 0 }))).toThrow(/not on a tile of any area/);
    expect(() => readMapTiles(mapOf([area(['T.'])], { column: 0, row: 0 }))).toThrow(/solid tile/);
  });

  it('a bad map fails when the sim is created, never inside a command handler', async () => {
    await expect(createSimInternal({ seed: 1, map: mapOf([area(['T.'])], { column: 9, row: 0 }) })).rejects.toThrow(/not on a tile/);
    await expect(createSimInternal({ seed: 1, map: mapOf([area(['T?'])], { column: 1, row: 0 }) })).rejects.toThrow(/no legend entry/);
    const sim = await createSimInternal({ seed: 1, map: mapOf([area(['T.'])], { column: 1, row: 0 }) });
    expect(() => sim.step([join()])).not.toThrow();
    expect(findPlayerEntity(sim, 0)).toBeDefined();
    sim.destroy();
  });

  it('reads a map object once and hands back the same tiles', () => {
    const tiles = readMapTiles(worldMap);
    expect(readMapTiles(worldMap)).toBe(tiles);
    expect(readMapTiles({ ...worldMap })).not.toBe(tiles);
  });

  it('gives the same checksum to the same terrain however it is cut into areas, and another to any other terrain or spawn', () => {
    const spawn = { column: 1, row: 1 };
    const whole = readMapTiles(mapOf([area(['TTTT', 'T..T', 'TTTT'])], spawn));
    const inTwoAreas = readMapTiles(mapOf([area(['TT', 'T.', 'TT'], { column: 0, row: 0 }, 'west'), area(['TT', '.T', 'TT'], { column: 2, row: 0 }, 'east')], spawn));
    expect(inTwoAreas.checksum).toBe(whole.checksum);
    expect(whole.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(readMapTiles(mapOf([area(['TTTT', 'T.oT', 'TTTT'])], spawn)).checksum).not.toBe(whole.checksum);
    expect(readMapTiles(mapOf([area(['TTTT', 'T..T', 'TTTT'])], { column: 2, row: 1 })).checksum).not.toBe(whole.checksum);
    expect(readMapTiles(mapOf([area(['TTTT', 'T..T', 'TTTT'], { column: 1, row: 0 })], { column: 2, row: 1 })).checksum).not.toBe(whole.checksum);
    // The same tiles in another chunk, with the spawn where it was: only the chunk's coordinates differ.
    const withRockAt = (origin: TileCoordinate): string => readMapTiles(mapOf([area(['TTTT', 'T..T', 'TTTT']), area(['o'], origin, 'rock')], spawn)).checksum;
    expect(withRockAt({ column: 5, row: 5 + CHUNK_SIZE })).not.toBe(withRockAt({ column: 5, row: 5 + 2 * CHUNK_SIZE }));
    expect(withRockAt({ column: 5 + CHUNK_SIZE, row: 5 })).not.toBe(withRockAt({ column: 5, row: 5 + CHUNK_SIZE }));
  });
});

describe('the map checksum', () => {
  it('changes when a tile def becomes solid or stops being solid, though no tile moved: the colliders would differ', () => {
    const { chunks } = readMapTiles(worldMap);
    const checksumWith = (tileDefs: readonly { id: number; solid: boolean }[]): string => tilesTesting.checksumOf({ chunks, spawn: worldMap.spawn, tileDefs });
    expect(checksumWith(terrainDefs)).toBe(readMapTiles(worldMap).checksum);
    for (const flipped of terrainDefs) {
      expect(checksumWith(terrainDefs.map((def) => (def === flipped ? { ...def, solid: !def.solid } : def))), flipped.name).not.toBe(checksumWith(terrainDefs));
    }
    expect(checksumWith(terrainDefs.slice(1))).not.toBe(checksumWith(terrainDefs));
  });
});

describe('a world that grows', () => {
  it('keeps every existing tile, tile coordinate and position in metres when an area is added on any side', async () => {
    const before = readMapTiles(worldMap);
    const { bounds } = before;
    // Strips of grass with a tree on every fourth tile of every fourth row: new ground with new colliders in it.
    const strip = ({ name, origin, columns, rows }: { name: string; origin: TileCoordinate; columns: number; rows: number }): AreaData =>
      area(Array.from({ length: rows }, (_, row) => (row % 4 === 2 ? 'T...'.repeat(columns).slice(0, columns) : '.'.repeat(columns))), origin, name);
    const added = [
      strip({ name: 'north', origin: { column: bounds.column, row: bounds.row - 50 }, columns: bounds.width, rows: 50 }),
      strip({ name: 'south', origin: { column: bounds.column, row: bounds.row + bounds.height }, columns: bounds.width, rows: 50 }),
      strip({ name: 'west', origin: { column: bounds.column - 70, row: bounds.row }, columns: 70, rows: bounds.height }),
      strip({ name: 'east', origin: { column: bounds.column + bounds.width, row: bounds.row }, columns: 70, rows: bounds.height }),
    ];
    const grown: WorldMap = { ...worldMap, areas: [...worldMap.areas, ...added] };
    const after = readMapTiles(grown);
    expect(after.bounds).toEqual({ column: bounds.column - 70, row: bounds.row - 50, width: bounds.width + 140, height: bounds.height + 100 });

    // Every tile that existed is the same tile at the same coordinate, and the spawn did not move.
    for (const tile of tilesIn(bounds)) expect(tileDefIdAt(after, tile), `tile (${tile.column}, ${tile.row})`).toBe(tileDefIdAt(before, tile));
    expect(grown.spawn).toEqual(worldMap.spawn);
    expect(spawnPoint(grown)).toEqual(spawnPoint(worldMap));

    // The colliders cover the same ground inside the old bounds, metre for metre. They need not be the same boxes:
    // a new tree beside an old row of trees is merged into its box.
    const small = await createSimInternal({ seed: 7 });
    const big = await createSimInternal({ seed: 7, map: grown });
    const insideOldBounds = (tileKey: string): boolean => tileDefIdAt(before, tileFromKey(tileKey)) !== undefined;
    const coveredBefore = tilesCoveredBy(staticBoxes(small));
    const coveredAfter = tilesCoveredBy(staticBoxes(big));
    expect(coveredBefore.size).toBeGreaterThan(300);
    expect(new Set([...coveredAfter].filter(insideOldBounds))).toEqual(coveredBefore);
    expect(coveredAfter.size).toBeGreaterThan(coveredBefore.size + 400); // the strips brought their own trees

    // And the same commands walk the same players to the same positions, bit for bit.
    for (let tick = 0; tick < 300; tick += 1) {
      const commands = walk(tick);
      small.step(commands);
      big.step(commands);
    }
    expect(getRenderables(big)).toEqual(getRenderables(small));
    expect(getRenderables(small).length).toBe(3);
    small.destroy();
    big.destroy();
  });

  it('mounts a second area at the coordinates it reserves: its tiles and its colliders are there, in the same world', async () => {
    const house = area(['TTTTT', 'T...T', 'T.o.T', 'TTTTT'], { column: 1000, row: -500 }, 'house');
    const map: WorldMap = { ...worldMap, areas: [...worldMap.areas, house] };
    const tiles = readMapTiles(map);
    expect(tileDefIdAt(tiles, { column: 1000, row: -500 })).toBe(TerrainDefId.Tree);
    expect(tileDefIdAt(tiles, { column: 1001, row: -499 })).toBe(TerrainDefId.Grass);
    expect(tileDefIdAt(tiles, { column: 1002, row: -498 })).toBe(TerrainDefId.Rock);
    expect(tileDefIdAt(tiles, { column: 1005, row: -500 })).toBeUndefined();
    expect(findChunk(tiles, chunkCoordinateOf(house.origin))).toBeDefined();
    // Nothing is stored for the empty ground between the clearing and the house.
    expect(tiles.chunks).toHaveLength(readMapTiles(worldMap).chunks.length + 1);

    const sim = await createSimInternal({ seed: 1, map });
    const world = await createSimInternal({ seed: 1 });
    const houseBoxes = staticBoxes(sim).filter((box) => box.x > 999 * TILE_SIZE);
    expect(houseBoxes).toEqual([
      { x: 1002.5, y: -499.5, halfWidth: 2.5, halfHeight: 0.5 }, // top wall
      { x: 1000.5, y: -498, halfWidth: 0.5, halfHeight: 1 }, // west wall
      { x: 1004.5, y: -498, halfWidth: 0.5, halfHeight: 1 }, // east wall
      { x: 1002.5, y: -497.5, halfWidth: 0.5, halfHeight: 0.5 }, // the rock
      { x: 1002.5, y: -496.5, halfWidth: 2.5, halfHeight: 0.5 }, // bottom wall
    ].map((box) => ({ x: box.x * TILE_SIZE, y: box.y * TILE_SIZE, halfWidth: box.halfWidth * TILE_SIZE, halfHeight: box.halfHeight * TILE_SIZE })));
    expect(staticBoxes(sim).filter((box) => box.x <= 999 * TILE_SIZE)).toEqual(staticBoxes(world));
    // One sim, one physics world, one snapshot: the house is in the same physics bytes, and still no entity.
    expect(sim.entityCount).toBe(0);
    expect(sim.snapshot().physics.length).toBeGreaterThan(world.snapshot().physics.length);
    sim.destroy();
    world.destroy();
  });

  it('a player inside a mounted area is stopped by its walls', async () => {
    const house = area(['TTTTT', 'T...T', 'T...T', 'TTTTT'], { column: 1000, row: -500 }, 'house');
    const sim = await createSimInternal({ seed: 1, map: { areas: [...worldMap.areas, house], spawn: { column: 1001, row: -499 } } });
    sim.step([join()]);
    sim.step([{ type: 'player/move', slot: 0, x: 1, y: 1 }]);
    for (let tick = 0; tick < 300; tick += 1) sim.step();
    const [player] = getRenderables(sim);
    expect(tileAt(player!.x, player!.y)).toEqual({ column: 1003, row: -498 });
    expect(player!.x).toBeCloseTo(1004 * TILE_SIZE - player!.halfWidth, 1);
    expect(player!.y).toBeCloseTo(-497 * TILE_SIZE - player!.halfHeight, 1);
    sim.destroy();
  });

  it('refuses an area that overlaps another by even one tile, naming both, and two areas with one name', () => {
    const spawn = { column: 1, row: 1 };
    const room = area(['TTT', 'T.T', 'TTT'], { column: 0, row: 0 }, 'room');
    for (const origin of [{ column: 2, row: 2 }, { column: -2, row: -2 }, { column: 0, row: 0 }, { column: 1, row: 1 }, { column: 2, row: -2 }]) {
      expect(() => readMapTiles(mapOf([room, area(['...', '...', '...'], origin, 'other')], spawn)), JSON.stringify(origin)).toThrow(/Areas "room" and "other" overlap/);
    }
    // Touching is not overlapping: areas sit side by side.
    for (const origin of [{ column: 3, row: 0 }, { column: -3, row: 0 }, { column: 0, row: 3 }, { column: 0, row: -3 }, { column: 3, row: 3 }]) {
      expect(() => readMapTiles(mapOf([room, area(['...', '...', '...'], origin, 'other')], spawn)), JSON.stringify(origin)).not.toThrow();
    }
    expect(() => readMapTiles(mapOf([room, { ...room, origin: { column: 50, row: 50 } }], spawn))).toThrow(/Two areas are named "room"/);
    expect(() => readMapTiles({ ...worldMap, areas: [...worldMap.areas, area(['.'], worldMap.spawn, 'on-the-spawn')] })).toThrow(/overlap/);
  });
});

describe('the world', () => {
  it('is one area today, the clearing, with its top-left tile on the origin', () => {
    expect(worldMap.areas.map((mounted) => mounted.name)).toEqual(['clearing']);
    expect(readMapTiles(worldMap).bounds).toEqual({ column: 0, row: 0, width: 40, height: 30 });
  });

  it('has no paths: every tile is grass, a tree or a rock', () => {
    const tiles = readMapTiles(worldMap);
    expect(new Set(tilesIn(tiles.bounds).map((tile) => tileDefIdAt(tiles, tile)))).toEqual(new Set([TerrainDefId.Grass, TerrainDefId.Tree, TerrainDefId.Rock]));
    for (const mounted of worldMap.areas) expect(Object.values(mounted.legend)).not.toContain(TerrainDefId.Dirt);
  });

  it('is ringed by trees with no gap, so nothing walks off the map', () => {
    const tiles = readMapTiles(worldMap);
    const { column, row, width, height } = tiles.bounds;
    const edgeTiles = tilesIn(tiles.bounds).filter((tile) => tile.column === column || tile.row === row || tile.column === column + width - 1 || tile.row === row + height - 1);
    expect(new Set(edgeTiles.map((tile) => tileDefIdAt(tiles, tile)))).toEqual(new Set([TerrainDefId.Tree]));
  });

  it('spawns on grass, with every other grass tile within reach', () => {
    const tiles = readMapTiles(worldMap);
    expect(tileDefIdAt(tiles, worldMap.spawn)).toBe(TerrainDefId.Grass);
    const walkableTiles = tilesIn(tiles.bounds).filter((tile) => isWalkable(tile)).length;
    expect(walkableTilesReachableFrom(worldMap.spawn)).toHaveLength(walkableTiles);
  });
});

describe('a generated map', () => {
  it('is the same every time, ringed by trees, with a walkable spawn, and readable at 400x300', () => {
    const map = generatedWorldMap({ columns: 400, rows: 300 });
    expect(generatedWorldMap({ columns: 400, rows: 300 })).toEqual(map);
    const tiles = readMapTiles(map);
    expect(tiles.bounds).toEqual({ column: 0, row: 0, width: 400, height: 300 });
    expect(tiles.chunks).toHaveLength(Math.ceil(400 / CHUNK_SIZE) * Math.ceil(300 / CHUNK_SIZE));
    expect(getTileDef(tileDefIdAt(tiles, map.spawn) as number).solid).toBe(false);
    for (const tile of [{ column: 0, row: 0 }, { column: 399, row: 299 }, { column: 1, row: 150 }, { column: 200, row: 298 }]) expect(tileDefIdAt(tiles, tile)).toBe(TerrainDefId.Tree);
    expect(() => generatedWorldMap({ columns: 4, rows: 300 })).toThrow(RangeError);
  });
});

// ---- Helpers ----

const { createSimInternal } = __testing__;
const { staticBoxes } = physicsTesting;

const legend = { T: TerrainDefId.Tree, '.': TerrainDefId.Grass, '=': TerrainDefId.Dirt, o: TerrainDefId.Rock };

function area(rows: readonly string[], origin: TileCoordinate = { column: 0, row: 0 }, name = 'test'): AreaData {
  return { name, origin, legend, rows };
}

function mapOf(areas: readonly AreaData[], spawn: TileCoordinate): WorldMap {
  return { areas, spawn };
}

const join = (slot = 0): Command => ({ type: 'player/join', slot });

/** Three players who join and are pushed around, into trees included. */
function walk(tick: number): Command[] {
  if (tick === 0) return [join(0), join(1), join(2)];
  if (tick % 40 !== 1) return [];
  const turn = Math.floor(tick / 40);
  return [0, 1, 2].map((slot) => ({ type: 'player/move', slot, x: Math.cos(turn * 2 + slot), y: Math.sin(turn * 3 + slot * 2) }));
}

function tilesIn({ column, row, width, height }: { column: number; row: number; width: number; height: number }): TileCoordinate[] {
  const tiles: TileCoordinate[] = [];
  for (let tileRow = row; tileRow < row + height; tileRow += 1) {
    for (let tileColumn = column; tileColumn < column + width; tileColumn += 1) tiles.push({ column: tileColumn, row: tileRow });
  }
  return tiles;
}

/** The tiles a list of boxes in metres covers, as "column,row" keys. Throws if two boxes cover one tile. */
function tilesCoveredBy(boxes: readonly { x: number; y: number; halfWidth: number; halfHeight: number }[]): Set<string> {
  const covered = new Set<string>();
  for (const box of boxes) {
    const rectangle = { column: (box.x - box.halfWidth) / TILE_SIZE, row: (box.y - box.halfHeight) / TILE_SIZE, width: (2 * box.halfWidth) / TILE_SIZE, height: (2 * box.halfHeight) / TILE_SIZE };
    for (const { column, row } of tilesIn(rectangle)) {
      if (covered.has(`${column},${row}`)) throw new Error(`tile (${column}, ${row}) is covered twice`);
      covered.add(`${column},${row}`);
    }
  }
  return covered;
}

function tileFromKey(tileKey: string): TileCoordinate {
  const [column, row] = tileKey.split(',').map(Number) as [number, number];
  return { column, row };
}

function isWalkable(tile: TileCoordinate): boolean {
  const defId = tileDefIdAt(readMapTiles(worldMap), tile);
  return defId !== undefined && !getTileDef(defId).solid;
}

/** Every walkable tile of the world that can be reached from `start` by stepping to a walkable neighbour up, down, left or right. */
function walkableTilesReachableFrom(start: TileCoordinate): TileCoordinate[] {
  const reached = new Map<string, TileCoordinate>();
  const toVisit = [start];
  while (toVisit.length > 0) {
    const tile = toVisit.pop()!;
    const key = `${tile.column},${tile.row}`;
    if (reached.has(key) || !isWalkable(tile)) continue;
    reached.set(key, tile);
    toVisit.push({ column: tile.column + 1, row: tile.row }, { column: tile.column - 1, row: tile.row }, { column: tile.column, row: tile.row + 1 }, { column: tile.column, row: tile.row - 1 });
  }
  return [...reached.values()];
}

