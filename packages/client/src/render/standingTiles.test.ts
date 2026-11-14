import { getTileDef, readTileGrid, starterLevel, terrainDefs, tileCentre, TILE_SIZE, type LevelData } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { depthOfBottomEdge } from './depth';
import { __testing__, standingTilePlacements } from './standingTiles';
import { PIXELS_PER_METRE } from './units';

const { variantOfTile } = __testing__;

describe('standingTilePlacements', () => {
  it('places one image per tree tile and none for flat tiles', () => {
    const placements = standingTilePlacements(readTileGrid(level(['T.T', '.o.', '=T.'])));
    expect(placements.map(({ column, row }) => [column, row])).toEqual([
      [0, 0],
      [2, 0],
      [1, 2],
    ]);
    for (const placement of placements) expect(placement.sprite).toBe(getTileDef(treeDefId()).standingSprite);
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

  it('covers every tree of the starter level with a frame the sheet has', () => {
    const grid = readTileGrid(starterLevel);
    const placements = standingTilePlacements(grid);
    const treeTiles = grid.defIds.flat().filter((defId) => defId === treeDefId()).length;
    expect(placements).toHaveLength(treeTiles);
    for (const { frame, sprite } of placements) {
      expect(Number.isInteger(frame) && frame >= 0 && frame < sprite.variantCount).toBe(true);
    }
  });
});

describe('variantOfTile', () => {
  it('gives a tile the same variant every time', () => {
    expect(variantOfTile({ column: 7, row: 3, variantCount: 3 })).toBe(variantOfTile({ column: 7, row: 3, variantCount: 3 }));
  });

  it('uses every variant about as often across a forest', () => {
    const counts = [0, 0, 0];
    for (let row = 0; row < 30; row += 1) {
      for (let column = 0; column < 40; column += 1) counts[variantOfTile({ column, row, variantCount: 3 })]! += 1;
    }
    for (const count of counts) expect(count).toBeGreaterThan(300);
  });

  it('does not paint whole rows or columns in one variant', () => {
    for (let line = 0; line < 30; line += 1) {
      expect(new Set(Array.from({ length: 30 }, (_, index) => variantOfTile({ column: index, row: line, variantCount: 3 }))).size).toBeGreaterThan(1);
      expect(new Set(Array.from({ length: 30 }, (_, index) => variantOfTile({ column: line, row: index, variantCount: 3 }))).size).toBeGreaterThan(1);
    }
  });
});

// ---- Helpers ----

function treeDefId(): number {
  const tree = terrainDefs.find((def) => def.name === 'tree');
  if (!tree) throw new Error('There is no tree def');
  return tree.id;
}

/** A level of these rows; the spawn is its first walkable tile, as a level must have one. */
function level(rows: string[]): LevelData {
  const idOf = (name: string): number => terrainDefs.find((def) => def.name === name)!.id;
  const spawnRow = rows.findIndex((row) => /[.=]/.test(row));
  const spawn = { column: rows[spawnRow]!.search(/[.=]/), row: spawnRow };
  return { name: 'test', legend: { T: idOf('tree'), '.': idOf('grass'), '=': idOf('dirt'), o: idOf('rock') }, rows, spawn };
}
