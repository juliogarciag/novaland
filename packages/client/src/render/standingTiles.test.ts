import { getTileDef, readTileGrid, starterLevel, terrainDefs, tileCentre, TILE_SIZE, type LevelData } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { depthOfBottomEdge } from './depth';
import { standingTilePlacements } from './standingTiles';
import { PIXELS_PER_METRE } from './units';

describe('standingTilePlacements', () => {
  it('places one image per tree or rock tile and none for flat tiles', () => {
    const grid = readTileGrid(level(['T.T', '.o.', '=T.']));
    const placements = standingTilePlacements(grid);
    expect(placements.map(({ column, row, sprite }) => [column, row, sprite.key])).toEqual([
      [0, 0, 'tree'],
      [2, 0, 'tree'],
      [1, 1, 'rock'],
      [1, 2, 'tree'],
    ]);
    for (const placement of placements) expect(placement.sprite).toBe(getTileDef(grid.defIds[placement.row]![placement.column]!).standingSprite);
  });

  it('stands the image on the bottom centre of its tile', () => {
    const grid = readTileGrid(level(['...', '.T.', '...']));
    const [placement] = standingTilePlacements(grid);
    const centre = tileCentre(grid, { column: 1, row: 1 });
    expect(placement).toMatchObject({ x: centre.x * PIXELS_PER_METRE, y: (centre.y + TILE_SIZE / 2) * PIXELS_PER_METRE });
  });

  it('sorts by the bottom edge of the tile, like an entity by the bottom edge of its body', () => {
    const grid = readTileGrid(level(['.', 'T', '.']));
    const [tree] = standingTilePlacements(grid);
    const bodyHalfHeight = 0.4;
    const depthOfBodyAt = (y: number): number => depthOfBottomEdge(y + bodyHalfHeight); // as render/entities.ts does
    const treeCentre = tileCentre(grid, { column: 0, row: 1 });
    // The closest a body can stand on either side: touching the solid tile.
    const touchingFromNorth = treeCentre.y - TILE_SIZE / 2 - bodyHalfHeight;
    const touchingFromSouth = treeCentre.y + TILE_SIZE / 2 + bodyHalfHeight;
    expect(depthOfBodyAt(touchingFromNorth)).toBeLessThan(tree!.depth);
    expect(depthOfBodyAt(touchingFromSouth)).toBeGreaterThan(tree!.depth);
    // Beside the tree, level with it: the tree's foot is further south than the body's, so the tree is in front.
    expect(depthOfBodyAt(treeCentre.y)).toBeLessThan(tree!.depth);
  });

  it('draws trees further south over trees further north', () => {
    const depths = standingTilePlacements(readTileGrid(level(['T.', 'T.', 'T.']))).map((placement) => placement.depth);
    expect(depths).toEqual([...depths].sort((first, second) => first - second));
    expect(new Set(depths).size).toBe(3);
  });

  it('covers every tree and rock of the starter level with a frame its sheet has', () => {
    const grid = readTileGrid(starterLevel);
    const placements = standingTilePlacements(grid);
    const standingTiles = grid.defIds.flat().filter((defId) => getTileDef(defId).standingSprite).length;
    expect(placements).toHaveLength(standingTiles);
    expect(new Set(placements.map((placement) => placement.sprite.key))).toEqual(new Set(['tree', 'rock']));
    for (const { frame, sprite } of placements) {
      expect(Number.isInteger(frame) && frame >= 0 && frame < sprite.variantCount).toBe(true);
    }
  });
});

// ---- Helpers ----

/** A level of these rows; the spawn is its first walkable tile, as a level must have one. */
function level(rows: string[]): LevelData {
  const idOf = (name: string): number => terrainDefs.find((def) => def.name === name)!.id;
  const spawnRow = rows.findIndex((row) => /[.=]/.test(row));
  const spawn = { column: rows[spawnRow]!.search(/[.=]/), row: spawnRow };
  return { name: 'test', legend: { T: idOf('tree'), '.': idOf('grass'), '=': idOf('dirt'), o: idOf('rock') }, rows, spawn };
}
