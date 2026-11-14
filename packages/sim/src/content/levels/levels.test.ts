import { describe, expect, it } from 'vitest';
import { createSim } from '../../core/create';
import { getTileDef, TerrainDefId } from '../../features/terrain/defs';
import { readTileGrid } from './grid';
import { findLevel, levels } from './index';
import { starterLevel } from './starter';

describe('levels by name', () => {
  it('resolves the name a snapshot or a welcome message carries to the level object', async () => {
    const sim = await createSim();
    expect(findLevel(sim.snapshot().level)).toBe(sim.level);
    expect(findLevel(starterLevel.name)).toBe(starterLevel);
    sim.destroy();
  });

  it('answers undefined for a name it does not know, including prototype names', () => {
    for (const name of ['', 'nope', 'Starter', '__proto__', 'constructor', 'toString']) {
      expect(findLevel(name)).toBeUndefined();
    }
  });

  it('lists every level once, under a unique name', () => {
    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(levels.map((level) => level.name)).size).toBe(levels.length);
    for (const level of levels) expect(findLevel(level.name)).toBe(level);
  });
});

describe('the starter level', () => {
  it('has no paths: every tile is grass, a tree or a rock', () => {
    const defIds = new Set(readTileGrid(starterLevel).defIds.flat());
    expect(defIds).toEqual(new Set([TerrainDefId.Grass, TerrainDefId.Tree, TerrainDefId.Rock]));
    expect(Object.values(starterLevel.legend)).not.toContain(TerrainDefId.Dirt);
  });

  it('is ringed by trees with no gap, so nothing walks off the map', () => {
    const grid = readTileGrid(starterLevel);
    const outside = new Set(walkableTilesReachableFrom(starterLevel.spawn).filter(({ column, row }) => column === 0 || row === 0 || column === grid.columns - 1 || row === grid.rows - 1));
    expect(outside.size).toBe(0);
    const edgeTiles = [...grid.defIds[0]!, ...grid.defIds[grid.rows - 1]!, ...grid.defIds.map((row) => row[0]!), ...grid.defIds.map((row) => row[grid.columns - 1]!)];
    expect(new Set(edgeTiles)).toEqual(new Set([TerrainDefId.Tree]));
  });

  it('spawns on grass, with every other grass tile within reach', () => {
    const grid = readTileGrid(starterLevel);
    expect(grid.defIds[starterLevel.spawn.row]![starterLevel.spawn.column]).toBe(TerrainDefId.Grass);
    const walkableTiles = grid.defIds.flat().filter((defId) => !getTileDef(defId).solid).length;
    expect(walkableTilesReachableFrom(starterLevel.spawn)).toHaveLength(walkableTiles);
  });
});

// ---- Helpers ----

/** Every walkable tile of the starter level that can be reached from `start` by stepping to a walkable neighbour up, down, left or right. */
function walkableTilesReachableFrom(start: { column: number; row: number }): { column: number; row: number }[] {
  const grid = readTileGrid(starterLevel);
  const isWalkable = (column: number, row: number): boolean => {
    const defId = grid.defIds[row]?.[column];
    return defId !== undefined && !getTileDef(defId).solid;
  };
  const reached = new Map<string, { column: number; row: number }>();
  const toVisit = [start];
  while (toVisit.length > 0) {
    const tile = toVisit.pop()!;
    const key = `${tile.column},${tile.row}`;
    if (reached.has(key) || !isWalkable(tile.column, tile.row)) continue;
    reached.set(key, tile);
    toVisit.push({ column: tile.column + 1, row: tile.row }, { column: tile.column - 1, row: tile.row }, { column: tile.column, row: tile.row + 1 }, { column: tile.column, row: tile.row - 1 });
  }
  return [...reached.values()];
}
