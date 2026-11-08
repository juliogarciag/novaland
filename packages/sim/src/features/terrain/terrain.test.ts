import { describe, expect, it } from 'vitest';
import { DefId, getDef } from '../../content/defs';
import { readTileGrid, spawnPoint, tileAt, tileCentre } from '../../content/levels/grid';
import { starterLevel } from '../../content/levels/starter';
import type { LevelData } from '../../content/levels/types';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import type { Sim } from '../../core/sim';
import { getRenderables } from '../../core/view';
import { findPlayerEntity } from '../player/queries';
import { getTileDef, TerrainDefId, TILE_SIZE } from './defs';
import { solidRectangles } from './rectangles';

describe('tile grids', () => {
  it('reads ASCII rows through the legend into tile def ids, centred on the origin', () => {
    const grid = readTileGrid(level(['TTT', 'T.T', 'T=T']));
    expect(grid).toMatchObject({ columns: 3, rows: 3, tileSize: TILE_SIZE, width: 3 * TILE_SIZE, height: 3 * TILE_SIZE });
    expect(grid.defIds).toEqual([
      [DefId.Tree, DefId.Tree, DefId.Tree],
      [DefId.Tree, DefId.Grass, DefId.Tree],
      [DefId.Tree, DefId.Dirt, DefId.Tree],
    ]);
    expect(tileCentre(grid, { column: 1, row: 1 })).toEqual({ x: 0, y: 0 });
    expect(tileCentre(grid, { column: 0, row: 0 })).toEqual({ x: -TILE_SIZE, y: -TILE_SIZE });
    expect(tileAt(grid, -1.4 * TILE_SIZE, 1.2 * TILE_SIZE)).toEqual({ column: 0, row: 2 });
    expect(tileAt(grid, 2 * TILE_SIZE, 0)).toBeUndefined();
  });

  it('rejects ragged rows, unknown characters, non-tile defs and spawns outside the grid', () => {
    expect(() => readTileGrid(level(['TTT', 'TT']))).toThrow(/row 1 has 2 tiles, expected 3/);
    expect(() => readTileGrid(level(['T?T']))).toThrow(/no legend entry for "\?"/);
    expect(() => readTileGrid({ ...level(['T']), legend: { T: DefId.Player } })).toThrow(/not a tile/);
    expect(() => readTileGrid({ ...level(['T']), legend: { TT: DefId.Tree } })).toThrow(/one character/);
    expect(() => readTileGrid(level([]))).toThrow(/no rows/);
    expect(() => readTileGrid({ ...level(['T.']), spawn: { column: 2, row: 0 } })).toThrow(/outside/);
    expect(() => readTileGrid({ ...level(['T.']), spawn: { column: 0.5, row: 0 } })).toThrow(/outside/);
  });

  it('a bad level fails when the sim is created, never inside a command handler', async () => {
    await expect(createSimInternal({ seed: 1, level: { ...level(['T.']), spawn: { column: 9, row: 0 } } })).rejects.toThrow(/outside/);
    await expect(createSimInternal({ seed: 1, level: level(['T?']) })).rejects.toThrow(/no legend entry/);
    const sim = await createSimInternal({ seed: 1, level: { ...level(['T.']), spawn: { column: 1, row: 0 } } });
    expect(() => sim.step([join()])).not.toThrow();
    expect(findPlayerEntity(sim, 0)).toBeDefined();
    sim.destroy();
  });

  it('reads a level object once and hands back the same grid', () => {
    const grid = readTileGrid(starterLevel);
    expect(readTileGrid(starterLevel)).toBe(grid);
    expect(readTileGrid({ ...starterLevel })).not.toBe(grid);
  });
});

describe('solid tile merging', () => {
  it('merges horizontal runs so a whole row of trees is one rectangle', () => {
    const grid = readTileGrid(level(['TTTTTTTTTT', '..........']));
    expect(solidRectangles(grid)).toEqual([{ column: 0, row: 0, width: 10, height: 1 }]);
  });

  it('stacks identical runs vertically and keeps different ones apart', () => {
    const grid = readTileGrid(level(['TTTTTT', 'TT..TT', 'TT..TT', 'TTTTTT']));
    expect(solidRectangles(grid)).toEqual([
      { column: 0, row: 0, width: 6, height: 1 },
      { column: 0, row: 1, width: 2, height: 2 },
      { column: 4, row: 1, width: 2, height: 2 },
      { column: 0, row: 3, width: 6, height: 1 },
    ]);
  });

  it('treats rocks and trees alike (solid) and leaves grass and dirt out', () => {
    const grid = readTileGrid(level(['To=.oT']));
    expect(solidRectangles(grid)).toEqual([
      { column: 0, row: 0, width: 2, height: 1 },
      { column: 4, row: 0, width: 2, height: 1 },
    ]);
    expect(getTileDef(DefId.Grass).solid).toBe(false);
    expect(getTileDef(DefId.Dirt).solid).toBe(false);
  });

  it('covers every solid tile exactly once', () => {
    const grid = readTileGrid(starterLevel);
    const covered = grid.defIds.map((row) => row.map(() => 0));
    for (const { column, row, width, height } of solidRectangles(grid)) {
      for (let r = row; r < row + height; r += 1) {
        for (let c = column; c < column + width; c += 1) (covered[r] as number[])[c] = ((covered[r] as number[])[c] as number) + 1;
      }
    }
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.columns; c += 1) {
        const solid = getTileDef((grid.defIds[r] as number[])[c] as number).solid;
        expect((covered[r] as number[])[c], `tile (${c}, ${r})`).toBe(solid ? 1 : 0);
      }
    }
  });
});

describe('terrain feature (headless)', () => {
  it('spawns one static collider per merged rectangle and none of them is drawn', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const rectangles = solidRectangles(readTileGrid(starterLevel));
    expect(rectangles.length).toBeGreaterThan(4);
    expect(sim.entityCount).toBe(rectangles.length);
    expect(sim.physics.bodies.len()).toBe(rectangles.length);
    expect(getRenderables(sim)).toHaveLength(0);
    const colliders = sim.snapshot().entities.filter((entity) => entity.components['TerrainCollider']);
    expect(colliders).toHaveLength(rectangles.length);
    expect(colliders.map((entity) => entity.components['TerrainCollider'])).toEqual(rectangles.map((rectangle) => ({ ...rectangle })));
    sim.destroy();
  });

  it('places each collider box over its tiles in metres', async () => {
    const grid = readTileGrid(level(['....', 'TTT.', 'TTT.', '....']));
    const sim = await createSimInternal({ seed: 1, level: { ...level(['....', 'TTT.', 'TTT.', '....']), spawn: { column: 3, row: 0 } } });
    const [collider] = sim.snapshot().entities;
    expect(collider?.components['Position']).toEqual({ x: -0.5 * TILE_SIZE, y: 0 });
    expect(collider?.components['Extents']).toEqual({ halfWidth: 1.5 * TILE_SIZE, halfHeight: TILE_SIZE });
    expect(grid.width).toBe(4 * TILE_SIZE);
    sim.destroy();
  });

  it('the starter level spawns the player on a dirt path inside the forest', async () => {
    const grid = readTileGrid(starterLevel);
    const spawnTile = grid.defIds[starterLevel.spawn.row]?.[starterLevel.spawn.column];
    expect(spawnTile).toBe(DefId.Dirt);
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    expect(playerPosition(sim)).toEqual(spawnPoint(starterLevel));
    expect(tileAt(grid, ...xy(playerPosition(sim)))).toEqual(starterLevel.spawn);
    sim.destroy();
  });

  it('a player walks freely along a path and over grass', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const grid = readTileGrid(starterLevel);
    sim.step([join()]);
    const start = playerPosition(sim);
    const ticks = 90;
    sim.step([move(1, 0)]);
    for (let i = 1; i < ticks; i += 1) sim.step();
    const end = playerPosition(sim);
    expect(end.x).toBeCloseTo(start.x + SPEED * ticks * sim.dt, 3);
    expect(end.y).toBeCloseTo(start.y, 6);
    const walked = tileAt(grid, end.x, end.y);
    expect(walked && getTileDef((grid.defIds[walked.row] as number[])[walked.column] as number).name).toBe('dirt');
    sim.destroy();
  });

  it('trees block the player: walking into the forest border stops at the first tree face', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const grid = readTileGrid(starterLevel);
    sim.step([join()]);
    const spawn = playerPosition(sim);
    // The first solid tile straight above the spawn column.
    let treeRow = starterLevel.spawn.row;
    while (treeRow >= 0 && !getTileDef((grid.defIds[treeRow] as number[])[starterLevel.spawn.column] as number).solid) treeRow -= 1;
    expect(treeRow).toBeGreaterThanOrEqual(0);
    const treeFaceY = tileCentre(grid, { column: starterLevel.spawn.column, row: treeRow }).y + grid.tileSize / 2;
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

  it('a rock blocks the player too, and nothing escapes the level', async () => {
    const sim = await createSimInternal({ seed: 1, level: rockRoom });
    const grid = readTileGrid(rockRoom);
    sim.step([join()]);
    sim.step([move(1, 0)]);
    for (let i = 0; i < 300; i += 1) sim.step();
    const rockFaceX = tileCentre(grid, { column: 5, row: 2 }).x - grid.tileSize / 2;
    expect(playerPosition(sim).x).toBeLessThanOrEqual(rockFaceX - RADIUS + 0.01);
    expect(playerPosition(sim).x).toBeGreaterThan(rockFaceX - RADIUS - 0.2);
    for (const direction of [move(-1, -1), move(1, 1), move(-1, 1), move(1, -1)]) {
      sim.step([direction]);
      for (let i = 0; i < 300; i += 1) sim.step();
      const { x, y } = playerPosition(sim);
      expect(Math.abs(x)).toBeLessThan(grid.width / 2 - grid.tileSize);
      expect(Math.abs(y)).toBeLessThan(grid.height / 2 - grid.tileSize);
    }
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;

const playerDef = getDef(DefId.Player);
const SPEED = playerDef.speed ?? 0;
const RADIUS = playerDef.radius ?? 0;

const legend = { T: TerrainDefId.Tree, '.': TerrainDefId.Grass, '=': TerrainDefId.Dirt, o: TerrainDefId.Rock };

/** A level from rows alone, with the default legend and a spawn in the top-left corner. */
function level(rows: readonly string[]): LevelData {
  return { name: 'test', legend, rows, spawn: { column: 0, row: 0 } };
}

const rockRoom: LevelData = {
  ...level(['TTTTTTTT', 'T......T', 'T.=..o.T', 'T......T', 'TTTTTTTT']),
  spawn: { column: 2, row: 2 },
};

const join = (slot = 0): Command => ({ type: 'player/join', slot });
const move = (x: number, y: number, slot = 0): Command => ({ type: 'player/move', slot, x, y });
const xy = ({ x, y }: { x: number; y: number }): [number, number] => [x, y];

function playerPosition(sim: Sim, slot = 0) {
  const eid = findPlayerEntity(sim, slot);
  const renderable = getRenderables(sim).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error('player not rendered');
  return { x: renderable.x, y: renderable.y };
}
