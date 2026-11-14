import { getTileDef, tileCentre, type StandingTileSprite, type TileGrid } from '@novaland/sim';
import { depthOfBottomEdge } from './depth';
import { variantOfTile } from './tileVariant';
import { toPixels } from './units';

/** One image to draw for a tile that stands up from the ground, such as a tree or a rock. */
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
   * The depth of the tile's bottom edge. Entities get theirs from the bottom
   * edge of their body through the same function (render/depth.ts), so a
   * character south of the tile is drawn over the image and one north of it under it.
   */
  readonly depth: number;
}

/** Every tile of the grid whose def has a standing sprite, top row first, left to right. */
export function standingTilePlacements(grid: TileGrid): StandingTilePlacement[] {
  const placements: StandingTilePlacement[] = [];
  grid.defIds.forEach((defIdsOfRow, row) => {
    defIdsOfRow.forEach((defId, column) => {
      const sprite = getTileDef(defId).standingSprite;
      if (!sprite) return;
      const centre = tileCentre(grid, { column, row });
      const bottomEdge = centre.y + grid.tileSize / 2;
      placements.push({
        column,
        row,
        sprite,
        frame: variantOfTile({ column, row, variantCount: sprite.variantCount }),
        x: toPixels(centre.x),
        y: toPixels(bottomEdge),
        depth: depthOfBottomEdge(bottomEdge),
      });
    });
  });
  return placements;
}
