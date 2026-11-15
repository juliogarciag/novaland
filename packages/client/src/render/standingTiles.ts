import { CHUNK_SIZE, getTileDef, NO_TILE, tileCentre, TILE_SIZE, type MapChunk, type StandingTileSprite } from '@novaland/sim';
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
   * The depth of the tile's bottom edge, plus a sliver for its column.
   * Entities get theirs from the bottom edge of their body through the same
   * function (render/depth.ts), so a character south of the tile is drawn
   * over the image and one north of it under it. The sliver orders the
   * images of one row from west to east, so where two canopies overlap the
   * eastern one is on top whichever chunk was drawn first.
   */
  readonly depth: number;
}

/**
 * How much deeper a standing tile is drawn for each column east: far less
 * than a screen pixel across the whole world (`WORLD_LIMIT_TILES` columns
 * are a sixtieth of a pixel), so it only ever decides between images whose
 * tiles share a row.
 */
const DEPTH_PER_COLUMN = 1e-6;

/** Every tile of the chunk whose def has a standing sprite, top row first, left to right, in world tiles. */
export function standingTilePlacements(chunk: MapChunk): StandingTilePlacement[] {
  const placements: StandingTilePlacement[] = [];
  for (let localRow = 0; localRow < CHUNK_SIZE; localRow += 1) {
    for (let localColumn = 0; localColumn < CHUNK_SIZE; localColumn += 1) {
      const defId = chunk.defIds[localRow * CHUNK_SIZE + localColumn] as number;
      const sprite = defId === NO_TILE ? undefined : getTileDef(defId).standingSprite;
      if (!sprite) continue;
      const column = chunk.firstTile.column + localColumn;
      const row = chunk.firstTile.row + localRow;
      const centre = tileCentre({ column, row });
      const bottomEdge = centre.y + TILE_SIZE / 2;
      placements.push({
        column,
        row,
        sprite,
        frame: variantOfTile({ column, row, variantCount: sprite.variantCount }),
        x: toPixels(centre.x),
        y: toPixels(bottomEdge),
        depth: depthOfBottomEdge(bottomEdge) + column * DEPTH_PER_COLUMN,
      });
    }
  }
  return placements;
}
