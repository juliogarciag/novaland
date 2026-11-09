import { describe, expect, it } from 'vitest';
import { readTileGrid, spawnPoint, tileAt } from '../../content/levels/grid';
import { starterLevel } from '../../content/levels/starter';
import type { LevelData, TileCoordinate } from '../../content/levels/types';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import type { Sim } from '../../core/sim';
import { getRenderables } from '../../core/view';
import { getTileDef, TerrainDefId } from '../terrain/defs';
import { findPlayerEntity } from './queries';

describe('spread spawns (headless)', () => {
  it('puts the first player on the spawn tile itself', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join(0)]);
    expect(playerPosition(sim, 0)).toEqual(spawnPoint(starterLevel));
    sim.destroy();
  });

  it('lands five joins on five distinct, walkable tiles, all next to the spawn tile', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const grid = readTileGrid(starterLevel);
    sim.step([join(0), join(1), join(2), join(3), join(4)]);
    const tiles = [0, 1, 2, 3, 4].map((slot) => playerTile(sim, slot));
    expect(new Set(tiles.map((tile) => `${tile.column},${tile.row}`)).size).toBe(5);
    for (const tile of tiles) {
      expect(getTileDef((grid.defIds[tile.row] as number[])[tile.column] as number).solid).toBe(false);
      expect(Math.max(Math.abs(tile.column - starterLevel.spawn.column), Math.abs(tile.row - starterLevel.spawn.row))).toBeLessThanOrEqual(1);
    }
    // Bodies are smaller than half a tile, so neighbouring tiles never overlap.
    const positions = [0, 1, 2, 3, 4].map((slot) => playerPosition(sim, slot));
    const radius = getRenderables(sim)[0]?.halfWidth as number;
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        const distance = Math.hypot((positions[a] as { x: number }).x - (positions[b] as { x: number }).x, (positions[a] as { y: number }).y - (positions[b] as { y: number }).y);
        expect(distance).toBeGreaterThan(2 * radius);
      }
    }
    sim.destroy();
  });

  it('spreads players around the spawn, not in one line: five arrivals use both rows and columns', async () => {
    const sim = await createSimInternal({ seed: 2 });
    sim.step([join(0), join(1), join(2), join(3), join(4)]);
    const tiles = [0, 1, 2, 3, 4].map((slot) => playerTile(sim, slot));
    expect(new Set(tiles.map((tile) => tile.column)).size).toBeGreaterThan(1);
    expect(new Set(tiles.map((tile) => tile.row)).size).toBeGreaterThan(1);
    sim.destroy();
  });

  it('chooses the same tiles for the same seed and joins', async () => {
    const first = await createSimInternal({ seed: 4 });
    const again = await createSimInternal({ seed: 4 });
    for (const sim of [first, again]) sim.step([join(0), join(1), join(2), join(3), join(4)]);
    expect([0, 1, 2, 3, 4].map((slot) => playerTile(again, slot))).toEqual([0, 1, 2, 3, 4].map((slot) => playerTile(first, slot)));
    first.destroy();
    again.destroy();
  });

  it('skips solid tiles and tiles a player stands on, reaching further out when the first ring is full', async () => {
    const corridor: LevelData = { ...level(['TTTTTTTTTTT', 'T.........T', 'TTTTTTTTTTT']), spawn: { column: 5, row: 1 } };
    const sim = await createSimInternal({ seed: 1, level: corridor });
    sim.step([join(0), join(1), join(2), join(3), join(4)]);
    const tiles = [0, 1, 2, 3, 4].map((slot) => playerTile(sim, slot));
    expect(tiles.every((tile) => tile.row === 1)).toBe(true);
    expect(new Set(tiles.map((tile) => tile.column)).size).toBe(5);
    // Ring 1 only has two free tiles in a corridor, so the fourth and fifth player stand two tiles out.
    expect([...tiles.map((tile) => Math.abs(tile.column - 5))].sort((a, b) => a - b)).toEqual([0, 1, 1, 2, 2]);
    sim.destroy();
  });

  it('treats a tile a player walked onto as taken and a tile a player left as free again', async () => {
    const corridor: LevelData = { ...level(['TTTTTTTTTTT', 'T.........T', 'TTTTTTTTTTT']), spawn: { column: 5, row: 1 } };
    const sim = await createSimInternal({ seed: 1, level: corridor });
    const grid = readTileGrid(corridor);
    sim.step([join(0)]);
    // The first player walks one tile east and stops there. The spawn tile is free again, so the second join takes it...
    sim.step([move(1, 0, 0)]);
    for (let tick = 0; tick < Math.ceil(grid.tileSize / (5 * sim.dt)); tick += 1) sim.step();
    sim.step([move(0, 0, 0)]);
    expect(playerTile(sim, 0)).toEqual({ column: 6, row: 1 });
    sim.step([join(1)]);
    expect(playerTile(sim, 1)).toEqual(corridor.spawn);
    // ...and the third has one free tile left in ring 1: the west one, because the first player stands on the east one.
    sim.step([join(2)]);
    expect(playerTile(sim, 2)).toEqual({ column: 4, row: 1 });
    // Once everyone leaves, a new arrival is back on the spawn tile.
    sim.step([{ type: 'player/leave', slot: 0 }, { type: 'player/leave', slot: 1 }, { type: 'player/leave', slot: 2 }]);
    sim.step([join(3)]);
    expect(playerTile(sim, 3)).toEqual(corridor.spawn);
    sim.destroy();
  });

  it('falls back to the spawn tile, without throwing, when no tile is free', async () => {
    const closet: LevelData = { ...level(['TTT', 'T.T', 'TTT']), spawn: { column: 1, row: 1 } };
    const sim = await createSimInternal({ seed: 1, level: closet });
    expect(() => sim.step([join(0), join(1), join(2)])).not.toThrow();
    for (const slot of [0, 1, 2]) expect(playerTile(sim, slot)).toEqual(closet.spawn);
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;

const legend = { T: TerrainDefId.Tree, '.': TerrainDefId.Grass, '=': TerrainDefId.Dirt, o: TerrainDefId.Rock };

function level(rows: readonly string[]): LevelData {
  return { name: 'test', legend, rows, spawn: { column: 0, row: 0 } };
}

const join = (slot: number): Command => ({ type: 'player/join', slot });
const move = (x: number, y: number, slot: number): Command => ({ type: 'player/move', slot, x, y });

function playerPosition(sim: Sim, slot: number): { x: number; y: number } {
  const eid = findPlayerEntity(sim, slot);
  const renderable = getRenderables(sim).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error(`player in slot ${slot} not rendered`);
  return { x: renderable.x, y: renderable.y };
}

function playerTile(sim: Sim, slot: number): TileCoordinate {
  const { x, y } = playerPosition(sim, slot);
  const tile = tileAt(readTileGrid(sim.level), x, y);
  if (!tile) throw new Error(`player in slot ${slot} is outside the level`);
  return tile;
}
