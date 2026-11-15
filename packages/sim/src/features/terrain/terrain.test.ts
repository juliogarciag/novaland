import { describe, expect, it } from 'vitest';
import { DefId, entityDefs, getDef } from '../../content/defs';
import { worldMap } from '../../content/world';
import { generatedWorldMap } from '../../content/world/generated';
import { CHUNK_SIZE, readMapTiles, spawnPoint, tileAt, tileCentre, tileDefIdAt } from '../../content/world/tiles';
import type { AreaData, MapChunk, MapTiles, TileCoordinate, TileRectangle, WorldMap } from '../../content/world/types';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import { __testing__ as physicsTesting } from '../../core/physics';
import type { Sim } from '../../core/sim';
import { getRenderables } from '../../core/view';
import { worldState } from '../../core/worldState';
import { findPlayerEntity } from '../player/queries';
import { getTileDef, terrainDefs, TerrainDefId, TILE_SIZE } from './defs';
import { solidRectangles } from './rectangles';
import { guestCharacter } from '../player/character';

describe('tile defs', () => {
  it('a standing sprite has at least one variant and stands on a flat tile def', () => {
    const standingDefs = terrainDefs.filter((def) => def.standingSprite);
    expect(standingDefs.map((def) => def.id)).toEqual(expect.arrayContaining([TerrainDefId.Tree, TerrainDefId.Rock]));
    for (const def of standingDefs) {
      const sprite = def.standingSprite!;
      expect(Number.isInteger(sprite.variantCount) && sprite.variantCount >= 1, def.name).toBe(true);
      expect(sprite.frameWidth > 0 && sprite.frameHeight > 0 && sprite.pixelsPerMetre > 0, def.name).toBe(true);
      expect(getTileDef(sprite.groundDefId).standingSprite, def.name).toBeUndefined();
      expect(getTileDef(sprite.groundDefId).solid, def.name).toBe(false);
    }
  });

  it('a ground sprite has at least one variant and belongs to a tile that does not stand up', () => {
    const texturedDefs = terrainDefs.filter((def) => def.groundSprite);
    expect(texturedDefs.map((def) => def.id)).toContain(TerrainDefId.Grass);
    for (const def of texturedDefs) {
      const sprite = def.groundSprite!;
      expect(Number.isInteger(sprite.variantCount) && sprite.variantCount >= 1, def.name).toBe(true);
      expect(Number.isInteger(sprite.tilePixels) && sprite.tilePixels > 0, def.name).toBe(true);
      expect(def.standingSprite, def.name).toBeUndefined();
    }
  });

  it('no tile sprite shares its key with another sprite: they are one folder and one texture namespace', () => {
    const tileSpriteKeys = terrainDefs.flatMap((def) => [def.standingSprite?.key, def.groundSprite?.key].filter((key) => key !== undefined));
    const keys = [...new Set(entityDefs.flatMap((def) => (def.sprite ? [def.sprite.key] : []))), ...tileSpriteKeys];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a tree is still one solid tile to the sim, whatever it looks like', () => {
    expect(getTileDef(TerrainDefId.Tree)).toMatchObject({ id: 202, solid: true });
    expect(solidRectangles(onlyChunkOf(mapOf(['.T.'])))).toEqual([{ column: 1, row: 0, width: 1, height: 1 }]);
  });

  it('a rock is still one solid tile and grass still walkable ground, under the ids they always had', () => {
    expect(getTileDef(TerrainDefId.Rock)).toMatchObject({ id: 203, solid: true });
    expect(getTileDef(TerrainDefId.Grass)).toMatchObject({ id: 200, solid: false });
    expect(getTileDef(TerrainDefId.Dirt)).toMatchObject({ id: 201, solid: false });
    expect(solidRectangles(onlyChunkOf(mapOf(['.o.'])))).toEqual([{ column: 1, row: 0, width: 1, height: 1 }]);
  });
});

describe('solid tile merging', () => {
  it('merges horizontal runs so a whole row of trees is one rectangle', () => {
    expect(solidRectangles(onlyChunkOf(mapOf(['TTTTTTTTTT', '..........'])))).toEqual([{ column: 0, row: 0, width: 10, height: 1 }]);
  });

  it('stacks identical runs vertically and keeps different ones apart', () => {
    expect(solidRectangles(onlyChunkOf(mapOf(['TTTTTT', 'TT..TT', 'TT..TT', 'TTTTTT'])))).toEqual([
      { column: 0, row: 0, width: 6, height: 1 },
      { column: 0, row: 1, width: 2, height: 2 },
      { column: 4, row: 1, width: 2, height: 2 },
      { column: 0, row: 3, width: 6, height: 1 },
    ]);
  });

  it('treats rocks and trees alike (solid) and leaves grass, dirt and tiles no area drew out', () => {
    expect(solidRectangles(onlyChunkOf(mapOf(['To=.oT'])))).toEqual([
      { column: 0, row: 0, width: 2, height: 1 },
      { column: 4, row: 0, width: 2, height: 1 },
    ]);
    expect(getTileDef(DefId.Grass).solid).toBe(false);
    expect(getTileDef(DefId.Dirt).solid).toBe(false);
  });

  it('gives rectangles in world tiles, wherever the chunk is', () => {
    const map = mapOf(['.T', 'TT'], { column: -3, row: 70 });
    expect(solidRectangles(onlyChunkOf(map))).toEqual([
      { column: -2, row: 70, width: 1, height: 1 },
      { column: -3, row: 71, width: 2, height: 1 },
    ]);
  });

  it('never merges across a chunk edge: a wall through two chunks is one rectangle in each', () => {
    const wall = 'T'.repeat(CHUNK_SIZE + 8);
    const tiles = readMapTiles(mapOf([wall, '.'.repeat(wall.length)]));
    expect(tiles.chunks.map((chunk) => solidRectangles(chunk))).toEqual([
      [{ column: 0, row: 0, width: CHUNK_SIZE, height: 1 }],
      [{ column: CHUNK_SIZE, row: 0, width: 8, height: 1 }],
    ]);
  });

  it('covers every solid tile of the world exactly once, and nothing else', () => {
    for (const map of [worldMap, generatedWorldMap({ columns: 90, rows: 70 })]) {
      const tiles = readMapTiles(map);
      const timesCovered = new Map<string, number>();
      for (const chunk of tiles.chunks) {
        for (const tile of tilesOf(solidRectangles(chunk))) timesCovered.set(key(tile), (timesCovered.get(key(tile)) ?? 0) + 1);
      }
      for (const tile of tilesOf([tiles.bounds])) {
        const defId = tileDefIdAt(tiles, tile);
        const solid = defId !== undefined && getTileDef(defId).solid;
        expect(timesCovered.get(key(tile)) ?? 0, `tile (${tile.column}, ${tile.row})`).toBe(solid ? 1 : 0);
      }
      expect([...timesCovered.keys()].every((tileKey) => tileDefIdAt(tiles, tileFromKey(tileKey)) !== undefined)).toBe(true);
    }
  });
});

describe('terrain feature (headless)', () => {
  it('builds one static box per merged rectangle, chunk by chunk, and no entity at all', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const tiles = readMapTiles(worldMap);
    const rectangles = tiles.chunks.flatMap((chunk) => solidRectangles(chunk));
    expect(rectangles.length).toBeGreaterThan(4);
    expect(staticBoxes(sim)).toEqual(rectangles.map(boxOver));
    // One immovable body per chunk that has anything solid in it.
    expect(sim.physics.bodies.len()).toBe(tiles.chunks.filter((chunk) => solidRectangles(chunk).length > 0).length);
    expect(sim.entityCount).toBe(0);
    expect(sim.snapshot().entities).toEqual([]);
    expect(worldState(sim).entities).toEqual([]);
    expect(getRenderables(sim)).toHaveLength(0);
    sim.destroy();
  });

  it('places each box over its tiles in metres, measured from the fixed origin', async () => {
    const sim = await createSimInternal({ seed: 1, map: mapOf(['....', 'TTT.', 'TTT.', '....'], { column: 10, row: -4 }) });
    // A 3x2 block whose first tile is world tile (10, -3): 1.5 tiles wide of centre, one tile tall of centre.
    expect(staticBoxes(sim)).toEqual([{ x: 11.5 * TILE_SIZE, y: -2 * TILE_SIZE, halfWidth: 1.5 * TILE_SIZE, halfHeight: TILE_SIZE }]);
    sim.destroy();
  });

  it('builds the same boxes in the same order every time, and the same physics bytes', async () => {
    const map = generatedWorldMap({ columns: 90, rows: 70 });
    const first = await createSimInternal({ seed: 1, map });
    const again = await createSimInternal({ seed: 1, map: { ...map } });
    expect(staticBoxes(again)).toEqual(staticBoxes(first));
    expect(again.snapshot().physics).toBe(first.snapshot().physics);
    first.destroy();
    again.destroy();
  });

  it('names the map in the snapshot by its checksum, so a snapshot says which terrain its physics bytes hold', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const other = await createSimInternal({ seed: 1, map: mapOf(['T.']) });
    expect(sim.snapshot().map).toBe(readMapTiles(worldMap).checksum);
    expect(other.snapshot().map).toBe(readMapTiles(other.map).checksum);
    expect(other.snapshot().map).not.toBe(sim.snapshot().map);
    sim.destroy();
    other.destroy();
  });

  it('the world spawns the player on the grass inside the forest', async () => {
    expect(tileDefIdAt(readMapTiles(worldMap), worldMap.spawn)).toBe(DefId.Grass);
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    expect(playerPosition(sim)).toEqual(spawnPoint(worldMap));
    expect(tileAt(...xy(playerPosition(sim)))).toEqual(worldMap.spawn);
    sim.destroy();
  });

  it('a player walks freely over the grass, east and then south', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const tiles = readMapTiles(worldMap);
    sim.step([join()]);
    const start = playerPosition(sim);
    const ticks = 90;
    sim.step([move(1, 0)]);
    for (let i = 1; i < ticks; i += 1) sim.step();
    const afterEast = playerPosition(sim);
    expect(afterEast.x).toBeCloseTo(start.x + SPEED * ticks * sim.dt, 3);
    expect(afterEast.y).toBeCloseTo(start.y, 6);
    expect(tileNameUnder(tiles, afterEast)).toBe('grass');

    // Then south at the same speed (short enough to stop before the rock further down).
    const southTicks = 24;
    sim.step([move(0, 1)]);
    for (let i = 1; i < southTicks; i += 1) sim.step();
    const afterSouth = playerPosition(sim);
    expect(afterSouth.y).toBeCloseTo(afterEast.y + SPEED * southTicks * sim.dt, 3);
    expect(afterSouth.x).toBeCloseTo(afterEast.x, 6);
    expect(tileNameUnder(tiles, afterSouth)).toBe('grass');
    sim.destroy();
  });

  it('trees block the player: walking into the forest border stops at the first tree face', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const tiles = readMapTiles(worldMap);
    sim.step([join()]);
    const spawn = playerPosition(sim);
    // The first solid tile straight above the spawn column.
    let treeRow = worldMap.spawn.row;
    while (!getTileDef(tileDefIdAt(tiles, { column: worldMap.spawn.column, row: treeRow }) as number).solid) treeRow -= 1;
    const treeFaceY = tileCentre({ column: worldMap.spawn.column, row: treeRow }).y + tiles.tileSize / 2;
    const stopY = treeFaceY + RADIUS;

    sim.step([move(0, -1)]);
    for (let i = 0; i < 600; i += 1) sim.step();
    const blocked = playerPosition(sim);
    expect(blocked.y).toBeGreaterThanOrEqual(stopY - 0.01);
    expect(blocked.y).toBeLessThan(stopY + 0.2);
    expect(blocked.y).toBeLessThan(spawn.y);
    expect(blocked.x).toBeCloseTo(spawn.x, 6);
    sim.destroy();
  });

  it('a rock blocks the player too, and nothing escapes the room', async () => {
    const sim = await createSimInternal({ seed: 1, map: rockRoom });
    const { tileSize, bounds } = readMapTiles(rockRoom);
    sim.step([join()]);
    sim.step([move(1, 0)]);
    for (let i = 0; i < 300; i += 1) sim.step();
    const rockFaceX = tileCentre({ column: 5, row: 2 }).x - tileSize / 2;
    expect(playerPosition(sim).x).toBeLessThanOrEqual(rockFaceX - RADIUS + 0.01);
    expect(playerPosition(sim).x).toBeGreaterThan(rockFaceX - RADIUS - 0.2);
    for (const direction of [move(-1, -1), move(1, 1), move(-1, 1), move(1, -1)]) {
      sim.step([direction]);
      for (let i = 0; i < 300; i += 1) sim.step();
      const { x, y } = playerPosition(sim);
      // Inside the ring of trees: more than one tile from every edge of the room.
      expect(x).toBeGreaterThan((bounds.column + 1) * tileSize);
      expect(x).toBeLessThan((bounds.column + bounds.width - 1) * tileSize);
      expect(y).toBeGreaterThan((bounds.row + 1) * tileSize);
      expect(y).toBeLessThan((bounds.row + bounds.height - 1) * tileSize);
    }
    sim.destroy();
  });

  it('a wall that crosses a chunk edge is as solid at the seam as anywhere else', async () => {
    // A corridor along a wall that runs through two chunks; the player slides east along it, across the seam.
    const length = CHUNK_SIZE + 12;
    const map: WorldMap = { areas: [area(['T'.repeat(length), `T${'.'.repeat(length - 2)}T`, 'T'.repeat(length)], { column: CHUNK_SIZE - 20, row: 0 })], spawn: { column: CHUNK_SIZE - 18, row: 1 } };
    expect(readMapTiles(map).chunks).toHaveLength(2);
    const sim = await createSimInternal({ seed: 1, map });
    sim.step([join()]);
    const start = playerPosition(sim);
    sim.step([move(1, -1)]);
    let lastX = start.x;
    for (let tick = 0; tick < 600; tick += 1) {
      sim.step();
      const { x, y } = playerPosition(sim);
      expect(y, `tick ${tick}`).toBeGreaterThan(1 * TILE_SIZE + RADIUS - 0.05); // never into the wall, seam included
      expect(x, `tick ${tick}`).toBeGreaterThanOrEqual(lastX - 1e-9); // never caught or pushed back
      lastX = x;
    }
    // It reached the far end, past the seam at column CHUNK_SIZE.
    expect(lastX).toBeGreaterThan((CHUNK_SIZE + 5) * TILE_SIZE);
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;
const { staticBoxes } = physicsTesting;

const playerDef = getDef(DefId.Player);
const SPEED = playerDef.speed ?? 0;
const RADIUS = playerDef.radius ?? 0;

const legend = { T: TerrainDefId.Tree, '.': TerrainDefId.Grass, '=': TerrainDefId.Dirt, o: TerrainDefId.Rock };

function area(rows: readonly string[], origin: TileCoordinate = { column: 0, row: 0 }, name = 'test'): AreaData {
  return { name, origin, legend, rows };
}

/** A map of one area from rows alone, with the spawn on its first walkable tile. */
function mapOf(rows: readonly string[], origin: TileCoordinate = { column: 0, row: 0 }): WorldMap {
  for (const [rowIndex, text] of rows.entries()) {
    const columnIndex = [...text].findIndex((character) => character !== 'T' && character !== 'o');
    if (columnIndex >= 0) return { areas: [area(rows, origin)], spawn: { column: origin.column + columnIndex, row: origin.row + rowIndex } };
  }
  throw new Error('a test map needs a walkable tile to spawn on');
}

function onlyChunkOf(map: WorldMap): MapChunk {
  const { chunks } = readMapTiles(map);
  if (chunks.length !== 1) throw new Error(`expected one chunk, got ${chunks.length}`);
  return chunks[0] as MapChunk;
}

/** The box in metres that covers a rectangle of tiles. */
function boxOver(rectangle: TileRectangle) {
  const halfWidth = (rectangle.width * TILE_SIZE) / 2;
  const halfHeight = (rectangle.height * TILE_SIZE) / 2;
  return { x: rectangle.column * TILE_SIZE + halfWidth, y: rectangle.row * TILE_SIZE + halfHeight, halfWidth, halfHeight };
}

function tilesOf(rectangles: readonly TileRectangle[]): TileCoordinate[] {
  const tiles: TileCoordinate[] = [];
  for (const { column, row, width, height } of rectangles) {
    for (let tileRow = row; tileRow < row + height; tileRow += 1) {
      for (let tileColumn = column; tileColumn < column + width; tileColumn += 1) tiles.push({ column: tileColumn, row: tileRow });
    }
  }
  return tiles;
}

const key = ({ column, row }: TileCoordinate): string => `${column},${row}`;

function tileFromKey(tileKey: string): TileCoordinate {
  const [column, row] = tileKey.split(',').map(Number) as [number, number];
  return { column, row };
}

const rockRoom: WorldMap = {
  areas: [area(['TTTTTTTT', 'T......T', 'T.=..o.T', 'T......T', 'TTTTTTTT'])],
  spawn: { column: 2, row: 2 },
};

const join = (slot = 0): Command => ({ type: 'player/join', slot, character: guestCharacter(slot) });
const move = (x: number, y: number, slot = 0): Command => ({ type: 'player/move', slot, x, y });

function playerPosition(sim: Sim, slot = 0) {
  const eid = findPlayerEntity(sim, slot);
  const renderable = getRenderables(sim).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error('player not rendered');
  return { x: renderable.x, y: renderable.y };
}

const xy = ({ x, y }: { x: number; y: number }): [number, number] => [x, y];

function tileNameUnder(tiles: MapTiles, { x, y }: { x: number; y: number }): string {
  const tile = tileAt(x, y);
  const defId = tile && tileDefIdAt(tiles, tile);
  if (defId === undefined) throw new Error(`(${x}, ${y}) is on no tile`);
  return getTileDef(defId).name;
}
