import { describe, expect, it } from 'vitest';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import { getRenderables } from '../../core/view';
import { playerDefs } from '../../features/player/defs';
import { getTileDef, terrainDefs, TerrainDefId, TILE_SIZE } from '../../features/terrain/defs';
import { worldMap } from './index';
import { readMapTiles, tileCentre, tileDefIdAt } from './tiles';
import type { TileCoordinate } from './types';

describe('water', () => {
  it('is a flat tile nobody walks on: solid, drawn in the ground, under an id of its own', () => {
    const water = getTileDef(TerrainDefId.Water);
    expect(water).toMatchObject({ id: 204, name: 'water', solid: true });
    expect(water.standingSprite).toBeUndefined();
    expect(water.groundSprite).toBeDefined();
  });

  it('has a colour far from every other tile, so a view that draws tiles by colour shows the lakes', () => {
    const water = getTileDef(TerrainDefId.Water);
    for (const def of terrainDefs.filter((other) => other.id !== water.id)) expect(colourDistance(water.color, def.color), def.name).toBeGreaterThan(90);
    // Blue before anything else: that is what reads as water.
    const [red, green, blue] = channels(water.color);
    expect(blue).toBeGreaterThan(red + 60);
    expect(blue).toBeGreaterThan(green + 60);
  });

  it('blocks a player: walking from the spawn to the lake in the clearing and into it stops at the shore', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join]);
    // The first to arrive stands on the spawn tile. East along its row there is a tile with only grass between it and water to the south.
    const water = firstWaterSouthOfTheSpawnRow();
    expect(water.row - worldMap.spawn.row).toBeGreaterThan(0);
    const waterFaceY = tileCentre(water).y - TILE_SIZE / 2;

    sim.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    for (let tick = 0; tick < 3000 && playerPosition(sim).x < tileCentre(water).x; tick += 1) sim.step();
    expect(playerPosition(sim).x).toBeGreaterThanOrEqual(tileCentre(water).x);
    sim.step([{ type: 'player/move', slot: 0, x: 0, y: 1 }]);
    for (let tick = 0; tick < 600; tick += 1) sim.step();
    const stopped = playerPosition(sim);
    expect(stopped.y).toBeLessThanOrEqual(waterFaceY - RADIUS + 0.01);
    expect(stopped.y).toBeGreaterThan(waterFaceY - RADIUS - 0.2);
    // Still walking into it a while later, and still on the shore.
    for (let tick = 0; tick < 300; tick += 1) sim.step();
    expect(playerPosition(sim).y).toBeCloseTo(stopped.y, 3);
    sim.destroy();
  });
});

describe('the lakes of the world', () => {
  it('are several, spread over the world: at least six, in at least six areas, on every side of the clearing', () => {
    expect(lakes.length).toBeGreaterThanOrEqual(6);
    expect(worldMap.areas.filter((mounted) => Object.values(mounted.legend).includes(TerrainDefId.Water)).length).toBeGreaterThanOrEqual(6);
    const centres = lakes.map(centreOf);
    expect(centres.some(({ column }) => column < 0)).toBe(true);
    expect(centres.some(({ column }) => column >= 40)).toBe(true);
    expect(centres.some(({ row }) => row < 0)).toBe(true);
    expect(centres.some(({ row }) => row >= 30)).toBe(true);
  });

  it('are small, of different sizes, and none is a plain rectangle', () => {
    for (const lake of lakes) {
      const { width, height } = boxOf(lake);
      expect(lake.length, describeLake(lake)).toBeGreaterThanOrEqual(8);
      expect(lake.length, describeLake(lake)).toBeLessThanOrEqual(50);
      expect(Math.max(width, height), describeLake(lake)).toBeLessThanOrEqual(10);
      // A rectangle fills its box. A lake leaves at least a fifth of it to the shore.
      expect(lake.length / (width * height), describeLake(lake)).toBeLessThan(0.8);
    }
    expect(new Set(lakes.map((lake) => lake.length)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(lakes.map(shapeOf)).size).toBe(lakes.length);
  });

  it('are lakes, not puddles in the trees: grass all the way round, so a player can walk the whole shore', () => {
    const tiles = readMapTiles(worldMap);
    for (const lake of lakes) {
      const inLake = new Set(lake.map(keyOf));
      const shore = lake.flatMap(neighboursWithDiagonals).filter((tile) => !inLake.has(keyOf(tile)));
      expect(new Set(shore.map((tile) => tileDefIdAt(tiles, tile))), describeLake(lake)).toEqual(new Set([TerrainDefId.Grass]));
    }
  });

  it('leave the spawn alone: no water within ten tiles of it', () => {
    for (const lake of lakes) {
      for (const tile of lake) expect(Math.max(Math.abs(tile.column - worldMap.spawn.column), Math.abs(tile.row - worldMap.spawn.row)), describeLake(lake)).toBeGreaterThan(10);
    }
  });

  it('never cut the world in two: every walkable tile is still reached from the spawn on foot', () => {
    const tiles = readMapTiles(worldMap);
    const reached = new Set(tilesReachedFrom(worldMap.spawn, (tile) => isWalkable(tile)).map(keyOf));
    const walkable = tilesOfTheWorld().filter(isWalkable);
    expect(walkable.filter((tile) => !reached.has(keyOf(tile)))).toEqual([]);
    // The check has teeth: the world has water, and with water walkable there would be more to reach.
    expect(tilesOfTheWorld().filter((tile) => tileDefIdAt(tiles, tile) === TerrainDefId.Water).length).toBe(lakes.flat().length);
    expect(walkable.length + lakes.flat().length).toBeGreaterThan(reached.size);
  });
});

// ---- Helpers ----

const { createSimInternal } = __testing__;

const join: Command = { type: 'player/join', slot: 0 };

const RADIUS = Math.max(...playerDefs.map((def) => def.radius ?? 0));

/** Every lake of the world: the groups of water tiles that touch side to side. */
const lakes: TileCoordinate[][] = findLakes();

function findLakes(): TileCoordinate[][] {
  const tiles = readMapTiles(worldMap);
  const isWater = (tile: TileCoordinate) => tileDefIdAt(tiles, tile) === TerrainDefId.Water;
  const seen = new Set<string>();
  const found: TileCoordinate[][] = [];
  for (const tile of tilesOfTheWorld()) {
    if (!isWater(tile) || seen.has(keyOf(tile))) continue;
    const lake = tilesReachedFrom(tile, isWater);
    for (const lakeTile of lake) seen.add(keyOf(lakeTile));
    found.push(lake);
  }
  return found;
}

function tilesOfTheWorld(): TileCoordinate[] {
  const { column, row, width, height } = readMapTiles(worldMap).bounds;
  const tiles: TileCoordinate[] = [];
  for (let tileRow = row; tileRow < row + height; tileRow += 1) {
    for (let tileColumn = column; tileColumn < column + width; tileColumn += 1) tiles.push({ column: tileColumn, row: tileRow });
  }
  return tiles;
}

function isWalkable(tile: TileCoordinate): boolean {
  const defId = tileDefIdAt(readMapTiles(worldMap), tile);
  return defId !== undefined && !getTileDef(defId).solid;
}

/** Every tile that `belongs` and can be reached from `start` by stepping up, down, left or right over tiles that belong. */
function tilesReachedFrom(start: TileCoordinate, belongs: (tile: TileCoordinate) => boolean): TileCoordinate[] {
  const reached = new Map<string, TileCoordinate>();
  const toVisit = [start];
  while (toVisit.length > 0) {
    const tile = toVisit.pop()!;
    if (reached.has(keyOf(tile)) || !belongs(tile)) continue;
    reached.set(keyOf(tile), tile);
    toVisit.push({ column: tile.column + 1, row: tile.row }, { column: tile.column - 1, row: tile.row }, { column: tile.column, row: tile.row + 1 }, { column: tile.column, row: tile.row - 1 });
  }
  return [...reached.values()];
}

function neighboursWithDiagonals({ column, row }: TileCoordinate): TileCoordinate[] {
  const neighbours: TileCoordinate[] = [];
  for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
    for (let columnStep = -1; columnStep <= 1; columnStep += 1) {
      if (rowStep !== 0 || columnStep !== 0) neighbours.push({ column: column + columnStep, row: row + rowStep });
    }
  }
  return neighbours;
}

/** The nearest water tile that a walk east along the spawn's row and then straight south, over grass alone, runs into. */
function firstWaterSouthOfTheSpawnRow(): TileCoordinate {
  const tiles = readMapTiles(worldMap);
  for (let column = worldMap.spawn.column; tileDefIdAt(tiles, { column, row: worldMap.spawn.row }) === TerrainDefId.Grass; column += 1) {
    let row = worldMap.spawn.row;
    while (tileDefIdAt(tiles, { column, row }) === TerrainDefId.Grass) row += 1;
    if (tileDefIdAt(tiles, { column, row }) === TerrainDefId.Water) return { column, row };
  }
  throw new Error('no water south of the spawn row');
}

function keyOf({ column, row }: TileCoordinate): string {
  return `${column},${row}`;
}

/** The smallest rectangle of tiles that holds the lake. */
function boxOf(lake: readonly TileCoordinate[]): { column: number; row: number; width: number; height: number } {
  const columns = lake.map((tile) => tile.column);
  const rows = lake.map((tile) => tile.row);
  const column = Math.min(...columns);
  const row = Math.min(...rows);
  return { column, row, width: Math.max(...columns) - column + 1, height: Math.max(...rows) - row + 1 };
}

function centreOf(lake: readonly TileCoordinate[]): TileCoordinate {
  const { column, row, width, height } = boxOf(lake);
  return { column: column + Math.floor(width / 2), row: row + Math.floor(height / 2) };
}

/** The lake's outline wherever it is: its tiles measured from the corner of its box, in a fixed order. */
function shapeOf(lake: readonly TileCoordinate[]): string {
  const { column, row } = boxOf(lake);
  return lake
    .map((tile) => keyOf({ column: tile.column - column, row: tile.row - row }))
    .sort()
    .join(' ');
}

function describeLake(lake: readonly TileCoordinate[]): string {
  const { column, row, width, height } = boxOf(lake);
  return `the lake of ${lake.length} tiles in the ${width}x${height} box at (${column}, ${row})`;
}

function playerPosition(sim: Awaited<ReturnType<typeof createSimInternal>>): { x: number; y: number } {
  const player = getRenderables(sim).find((renderable) => playerDefs.some((def) => def.id === renderable.defId));
  if (!player) throw new Error('no player in the sim');
  return { x: player.x, y: player.y };
}

function colourDistance(first: number, second: number): number {
  const [firstRed, firstGreen, firstBlue] = channels(first);
  const [secondRed, secondGreen, secondBlue] = channels(second);
  return Math.hypot(firstRed - secondRed, firstGreen - secondGreen, firstBlue - secondBlue);
}

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}
