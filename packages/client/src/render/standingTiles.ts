import { getTileDef, tileCentre, type StandingTileSprite, type TileGrid } from '@novaland/sim';
import { toPixels } from './units';

/** One image to draw for a tile that stands up from the ground, such as a tree. */
export interface StandingTilePlacement {
  readonly column: number;
  readonly row: number;
  readonly sprite: StandingTileSprite;
  /** Which of the sprite's variants this tile shows. */
  readonly frame: number;
  /** The bottom centre of the tile in pixels: where the bottom centre of the image goes. */
  readonly x: number;
  readonly y: number;
  /**
   * The tile's bottom edge in pixels. Entities are depth-sorted by the bottom
   * edge of their body (render/entities.ts), so with this depth a character
   * south of the tile is drawn over the image and one north of it under it.
   */
  readonly depth: number;
}

/** Every tile of the grid whose def has a standing sprite, top row first, left to right. */
export function standingTilePlacements(grid: TileGrid): StandingTilePlacement[] {
  const placements: StandingTilePlacement[] = [];
  grid.defIds.forEach((defIdsOfRow, row) => {
    defIdsOfRow.forEach((defId, column) => {
      const sprite = getTileDef(defId).standing;
      if (!sprite) return;
      const centre = tileCentre(grid, { column, row });
      const bottomEdge = toPixels(centre.y + grid.tileSize / 2);
      placements.push({ column, row, sprite, frame: variantOfTile({ column, row, variants: sprite.variants }), x: toPixels(centre.x), y: bottomEdge, depth: bottomEdge });
    });
  });
  return placements;
}

/**
 * Which variant a tile shows: scattered so neighbours rarely match, and the
 * same for a tile every time, so the forest does not change between visits
 * or between two players looking at it. Looks only: the sim knows nothing of it.
 */
function variantOfTile({ column, row, variants }: { column: number; row: number; variants: number }): number {
  let hash = (Math.imul(column, 374761393) + Math.imul(row, 668265263)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) % variants;
}

export const __testing__ = { variantOfTile };
