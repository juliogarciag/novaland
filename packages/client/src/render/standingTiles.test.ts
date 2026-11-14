import { getTileDef, NO_TILE, readMapTiles, terrainDefs, tileCentre, TILE_SIZE, worldMap, type MapChunk, type TileCoordinate } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { DRAW_MARGIN_TILES } from './chunkRange';
import { depthOfBottomEdge } from './depth';
import { standingTilePlacements } from './standingTiles';
import { PIXELS_PER_METRE } from './units';

describe('standingTilePlacements', () => {
  it('places one image per tree or rock tile and none for flat tiles or tiles no area drew, in world tiles', () => {
    for (const origin of [{ column: 0, row: 0 }, { column: -70, row: 45 }]) {
      const chunk = chunkOf(['T.T', '.o.', '=T.'], origin);
      const placements = standingTilePlacements(chunk);
      expect(placements.map(({ column, row, sprite }) => [column - origin.column, row - origin.row, sprite.key])).toEqual([
        [0, 0, 'tree'],
        [2, 0, 'tree'],
        [1, 1, 'rock'],
        [1, 2, 'tree'],
      ]);
    }
  });

  it('stands the image on the bottom centre of its tile', () => {
    const [placement] = standingTilePlacements(chunkOf(['...', '.T.', '...'], { column: 9, row: -4 }));
    const centre = tileCentre({ column: 10, row: -3 });
    expect(placement).toMatchObject({ x: centre.x * PIXELS_PER_METRE, y: (centre.y + TILE_SIZE / 2) * PIXELS_PER_METRE });
  });

  it('sorts by the bottom edge of the tile, like an entity by the bottom edge of its body', () => {
    const [tree] = standingTilePlacements(chunkOf(['.', 'T', '.']));
    const bodyHalfHeight = 0.4;
    const depthOfBodyAt = (y: number): number => depthOfBottomEdge(y + bodyHalfHeight); // as render/entities.ts does
    const treeCentre = tileCentre({ column: 0, row: 1 });
    // The closest a body can stand on either side: touching the solid tile.
    const touchingFromNorth = treeCentre.y - TILE_SIZE / 2 - bodyHalfHeight;
    const touchingFromSouth = treeCentre.y + TILE_SIZE / 2 + bodyHalfHeight;
    expect(depthOfBodyAt(touchingFromNorth)).toBeLessThan(tree!.depth);
    expect(depthOfBodyAt(touchingFromSouth)).toBeGreaterThan(tree!.depth);
    // Beside the tree, level with it: the tree's foot is further south than the body's, so the tree is in front.
    expect(depthOfBodyAt(treeCentre.y)).toBeLessThan(tree!.depth);
  });

  it('draws trees further south over trees further north', () => {
    const depths = standingTilePlacements(chunkOf(['T.', 'T.', 'T.'])).map((placement) => placement.depth);
    expect(depths).toEqual([...depths].sort((first, second) => first - second));
    expect(new Set(depths).size).toBe(3);
  });

  it('draws the eastern of two trees in a row on top whichever was created first, by far less than a pixel of depth', () => {
    // A row of trees through two chunks: the images of the western chunk may be created after those of the eastern one.
    const { chunks } = readMapTiles({ areas: [{ name: 'row', origin: { column: 28, row: 0 }, legend, rows: ['TTTTTTTT', '........'] }], spawn: { column: 28, row: 1 } });
    expect(chunks).toHaveLength(2);
    const placements = chunks.flatMap((chunk) => standingTilePlacements(chunk)).sort((first, second) => first.column - second.column);
    const depths = placements.map((placement) => placement.depth);
    for (let index = 1; index < depths.length; index += 1) expect(depths[index]!).toBeGreaterThan(depths[index - 1]!);
    expect(depths.at(-1)! - depths[0]!).toBeLessThan(0.001);
    // A row further north is still behind all of it.
    expect(Math.max(...standingTilePlacements(chunkOf(['T'], { column: 5000, row: -1 })).map((placement) => placement.depth))).toBeLessThan(depths[0]!);
  });

  it('covers every tree and rock of the world with a frame its sheet has', () => {
    const { chunks } = readMapTiles(worldMap);
    const placements = chunks.flatMap((chunk) => standingTilePlacements(chunk));
    const standingTiles = chunks.flatMap((chunk) => [...chunk.defIds]).filter((defId) => defId !== NO_TILE && getTileDef(defId).standingSprite).length;
    expect(placements).toHaveLength(standingTiles);
    expect(new Set(placements.map((placement) => placement.sprite.key))).toEqual(new Set(['tree', 'rock']));
    for (const { frame, sprite } of placements) {
      expect(Number.isInteger(frame) && frame >= 0 && frame < sprite.variantCount).toBe(true);
    }
  });

  it('no standing image reaches further from its tile than the margin chunks are drawn with', () => {
    for (const def of terrainDefs) {
      const sprite = def.standingSprite;
      if (!sprite) continue;
      const tilesTall = sprite.frameHeight / sprite.pixelsPerMetre / TILE_SIZE;
      const tilesWide = sprite.frameWidth / sprite.pixelsPerMetre / TILE_SIZE;
      expect(tilesTall - 1, def.name).toBeLessThanOrEqual(DRAW_MARGIN_TILES);
      expect((tilesWide - 1) / 2, def.name).toBeLessThanOrEqual(DRAW_MARGIN_TILES);
    }
  });
});

// ---- Helpers ----

const idOf = (name: string): number => terrainDefs.find((def) => def.name === name)!.id;
const legend = { T: idOf('tree'), '.': idOf('grass'), '=': idOf('dirt'), o: idOf('rock') };

/** The one chunk of a map made of these rows, mounted at `origin`; the spawn is its first walkable tile, as a map must have one. */
function chunkOf(rows: string[], origin: TileCoordinate = { column: 0, row: 0 }): MapChunk {
  const spawnRow = rows.findIndex((row) => /[.=]/.test(row));
  const spawn = spawnRow < 0 ? undefined : { column: origin.column + rows[spawnRow]!.search(/[.=]/), row: origin.row + spawnRow };
  // A map needs a walkable spawn: rows of nothing but trees get a patch of grass far away, in another chunk.
  const areas = [{ name: 'test', origin, legend, rows }, ...(spawn ? [] : [{ name: 'spawn', origin: { column: origin.column, row: origin.row + 200 }, legend, rows: ['.'] }])];
  const { chunks } = readMapTiles({ areas, spawn: spawn ?? { column: origin.column, row: origin.row + 200 } });
  return chunks[0]!;
}
