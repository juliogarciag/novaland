import { describe, expect, it } from 'vitest';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import { getRenderables } from '../../core/view';
import { playerDefs } from '../../features/player/defs';
import { getTileDef, terrainDefs, TerrainDefId, TILE_SIZE } from '../../features/terrain/defs';
import { worldMap } from './index';
import { readMapTiles, tileAt, tileCentre, tileDefIdAt } from './tiles';
import type { AreaData, TileCoordinate } from './types';

describe('water', () => {
  it('is a flat tile nobody walks on: solid, drawn in the ground, under an id of its own', () => {
    const water = getTileDef(TerrainDefId.Water);
    expect(water).toMatchObject({ id: 204, name: 'water', solid: true });
    expect(water.standingSprite).toBeUndefined();
    expect(water.groundSprite).toBeDefined();
  });

  it('has shallows beside it: a flat tile players wade through, under an id of its own', () => {
    const shallows = getTileDef(TerrainDefId.Shallows);
    expect(shallows).toMatchObject({ id: 205, name: 'shallows', solid: false });
    expect(shallows.standingSprite).toBeUndefined();
    expect(shallows.groundSprite).toBeDefined();
  });

  it('shows where it ends: the shallows draw an edge against the land, deep water against the shallows', () => {
    expect(getTileDef(TerrainDefId.Shallows).groundSprite?.edgeTiles?.sameSurfaceDefIds).toEqual([TerrainDefId.Shallows, TerrainDefId.Water]);
    expect(getTileDef(TerrainDefId.Water).groundSprite?.edgeTiles?.sameSurfaceDefIds).toEqual([TerrainDefId.Water]);
  });

  it('has colours far from every tile of the land and apart from each other, so a view that draws tiles by colour shows the lakes and their coast', () => {
    const water = getTileDef(TerrainDefId.Water);
    const shallows = getTileDef(TerrainDefId.Shallows);
    for (const def of terrainDefs.filter((other) => other.id !== water.id && other.id !== shallows.id)) {
      expect(colourDistance(water.color, def.color), def.name).toBeGreaterThan(90);
      expect(colourDistance(shallows.color, def.color), def.name).toBeGreaterThan(90);
    }
    expect(colourDistance(water.color, shallows.color)).toBeGreaterThan(60);
    // Blue before anything else: that is what reads as water. The shallows are the paler of the two.
    for (const def of [water, shallows]) {
      const [red, green, blue] = channels(def.color);
      expect(blue, def.name).toBeGreaterThan(red + 60);
      expect(blue, def.name).toBeGreaterThan(green + 40);
    }
    expect(channels(shallows.color).every((channel, index) => channel > channels(water.color)[index]!)).toBe(true);
  });

  it('lets a player wade in and stops them at the deep: walking from the spawn into the lake in the clearing ends in the shallows, at the edge of the water', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join]);
    // The first to arrive stands on the spawn tile. East along its row there is a tile with only ground to walk on between it and water to the south.
    const waterTile = firstWaterSouthOfTheSpawnRow();
    expect(areaOf(waterTile)?.name).toBe('clearing');
    const waterFaceY = tileCentre(waterTile).y - TILE_SIZE / 2;
    const playerRadius = radiusOfThePlayer(sim);

    sim.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    for (let tick = 0; tick < 3000 && playerPosition(sim).x < tileCentre(waterTile).x; tick += 1) sim.step();
    expect(playerPosition(sim).x).toBeGreaterThanOrEqual(tileCentre(waterTile).x);
    sim.step([{ type: 'player/move', slot: 0, x: 0, y: 1 }]);
    for (let tick = 0; tick < 600; tick += 1) sim.step();
    const stopped = playerPosition(sim);
    expect(stopped.y).toBeLessThanOrEqual(waterFaceY - playerRadius + 0.01);
    expect(stopped.y).toBeGreaterThan(waterFaceY - playerRadius - 0.2);
    // They are standing in the shallows: the tile under them is not land any more.
    expect(tileDefIdAt(readMapTiles(worldMap), tileAt(stopped.x, stopped.y)!)).toBe(TerrainDefId.Shallows);
    // Still walking into it a while later, and still at the edge of the deep.
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
    const clearing = worldMap.areas.find((mounted) => mounted.name === 'clearing')!;
    const { column: west, row: north } = clearing.origin;
    const east = west + (clearing.rows[0]?.length ?? 0);
    const south = north + clearing.rows.length;
    expect(centres.some(({ column }) => column < west)).toBe(true);
    expect(centres.some(({ column }) => column >= east)).toBe(true);
    expect(centres.some(({ row }) => row < north)).toBe(true);
    expect(centres.some(({ row }) => row >= south)).toBe(true);
  });

  it('are lakes, not puddles and not seas, of different sizes, and none is a plain rectangle', () => {
    for (const lake of lakes) {
      const { width, height } = boxOf(lake);
      expect(lake.length, describeLake(lake)).toBeGreaterThanOrEqual(30);
      expect(lake.length, describeLake(lake)).toBeLessThanOrEqual(120);
      expect(Math.min(width, height), describeLake(lake)).toBeGreaterThanOrEqual(6);
      expect(Math.max(width, height), describeLake(lake)).toBeLessThanOrEqual(14);
      // A rectangle fills its box. A lake leaves a good part of it to the land.
      expect(lake.length / (width * height), describeLake(lake)).toBeLessThan(0.85);
    }
    expect(new Set(lakes.map((lake) => lake.length)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(lakes.map(shapeOf)).size).toBe(lakes.length);
  });

  it('have a coast all the way round: deep water in the middle never touches the land, not even at a corner, and every tile of the shallows touches the deep', () => {
    const tiles = readMapTiles(worldMap);
    const defIdAt = (tile: TileCoordinate) => tileDefIdAt(tiles, tile);
    for (const lake of lakes) {
      const deep = lake.filter((tile) => defIdAt(tile) === TerrainDefId.Water);
      const shallows = lake.filter((tile) => defIdAt(tile) === TerrainDefId.Shallows);
      expect(deep.length, describeLake(lake)).toBeGreaterThanOrEqual(12);
      expect(shallows.length, describeLake(lake)).toBeGreaterThanOrEqual(15);
      expect(new Set(deep.flatMap(neighboursWithDiagonals).map(defIdAt)), describeLake(lake)).toEqual(new Set([TerrainDefId.Water, TerrainDefId.Shallows]));
      for (const tile of shallows) expect(neighboursWithDiagonals(tile).some((neighbour) => defIdAt(neighbour) === TerrainDefId.Water), `${keyOf(tile)} of ${describeLake(lake)}`).toBe(true);
    }
  });

  it('leave the spawn alone: no water within ten tiles of it', () => {
    for (const lake of lakes) {
      const tilesFromSpawn = Math.min(...lake.map((tile) => Math.max(Math.abs(tile.column - worldMap.spawn.column), Math.abs(tile.row - worldMap.spawn.row))));
      expect(tilesFromSpawn, describeLake(lake)).toBeGreaterThan(10);
    }
  });
});

// ---- Helpers ----

const { createSimInternal } = __testing__;

const join: Command = { type: 'player/join', slot: 0 };

/** Every lake of the world: the groups of water and shallows tiles that touch side to side. */
const lakes: TileCoordinate[][] = findLakes();

function findLakes(): TileCoordinate[][] {
  const tiles = readMapTiles(worldMap);
  const isWater = (tile: TileCoordinate) => [TerrainDefId.Water, TerrainDefId.Shallows].some((defId) => defId === tileDefIdAt(tiles, tile));
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

/** The nearest water tile that a walk east along the spawn's row and then straight south, over grass and shallows alone, runs into. */
function firstWaterSouthOfTheSpawnRow(): TileCoordinate {
  const tiles = readMapTiles(worldMap);
  const isWalkedOn = (tile: TileCoordinate) => [TerrainDefId.Grass, TerrainDefId.Shallows].some((defId) => defId === tileDefIdAt(tiles, tile));
  for (let column = worldMap.spawn.column; isWalkedOn({ column, row: worldMap.spawn.row }); column += 1) {
    let row = worldMap.spawn.row;
    while (tileDefIdAt(tiles, { column, row }) === TerrainDefId.Grass) row += 1;
    while (tileDefIdAt(tiles, { column, row }) === TerrainDefId.Shallows) row += 1;
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

function radiusOfThePlayer(sim: Awaited<ReturnType<typeof createSimInternal>>): number {
  const player = getRenderables(sim).find((renderable) => playerDefs.some((def) => def.id === renderable.defId));
  const radius = playerDefs.find((def) => def.id === player?.defId)?.radius;
  if (radius === undefined) throw new Error('the player in the sim has no radius');
  return radius;
}

/** The area that put a tile at this world tile. */
function areaOf({ column, row }: TileCoordinate): AreaData | undefined {
  return worldMap.areas.find(({ origin, rows }) => column >= origin.column && column < origin.column + (rows[0]?.length ?? 0) && row >= origin.row && row < origin.row + rows.length);
}

function colourDistance(first: number, second: number): number {
  const [firstRed, firstGreen, firstBlue] = channels(first);
  const [secondRed, secondGreen, secondBlue] = channels(second);
  return Math.hypot(firstRed - secondRed, firstGreen - secondGreen, firstBlue - secondBlue);
}

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}
