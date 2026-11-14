import { CHUNK_SIZE, getTileDef, NO_TILE, type GroundTileSprite, type MapChunk, type StandingTileSprite, type TileDef } from '@novaland/sim';
import { variantOfTile } from './tileVariant';

/** Side of one tile of the ground tileset in texture pixels. A ground sprite's tiles must be this size. */
export const GROUND_TILE_PIXELS = 16;

/**
 * The tiles one def owns in the ground tileset: `tileCount` of them in a
 * row starting at `firstTileIndex`. With a `groundSprite` they are the
 * variants of its sheet, in sheet order; without, the def owns one tile,
 * flat in its colour.
 */
export interface GroundTilesetSlot {
  readonly def: TileDef;
  readonly firstTileIndex: number;
  readonly tileCount: number;
  readonly groundSprite?: GroundTileSprite;
}

/**
 * One slot per tile def, in def order, laid end to end. A def is drawn from
 * its ground sprite only when `isTextureLoaded` says the sheet is there;
 * otherwise it falls back to one flat tile.
 */
export function groundTilesetSlots(tileDefs: readonly TileDef[], isTextureLoaded: (key: string) => boolean): GroundTilesetSlot[] {
  const slots: GroundTilesetSlot[] = [];
  let firstTileIndex = 0;
  for (const def of tileDefs) {
    const groundSprite = def.groundSprite && isTextureLoaded(def.groundSprite.key) ? def.groundSprite : undefined;
    if (groundSprite && groundSprite.tilePixels !== GROUND_TILE_PIXELS) {
      throw new Error(`The ground sprite of ${def.name} has ${groundSprite.tilePixels}-pixel tiles; the ground tileset needs ${GROUND_TILE_PIXELS}`);
    }
    const tileCount = groundSprite ? groundSprite.variantCount : 1;
    slots.push({ def, firstTileIndex, tileCount, ...(groundSprite ? { groundSprite } : {}) });
    firstTileIndex += tileCount;
  }
  return slots;
}

/** What a tilemap shows where there is no tile: nothing is drawn there. */
export const EMPTY_GROUND_TILE = -1;

/**
 * The tileset index of the ground at every tile of a chunk, row by row:
 * `CHUNK_SIZE` rows of `CHUNK_SIZE` indices, `EMPTY_GROUND_TILE` where no
 * area put a tile. A tile whose def stands up from the ground shows its
 * `groundDefId` there when its image is drawn (`isStandingImageDrawn`), and
 * its own flat tile when it is not. A def with several tiles shows the
 * variant its world column and row pick, so the ground under a tree is the
 * grass that tile would have had, and a tile looks the same whichever chunk
 * it is drawn with.
 */
export function groundTileIndexRows({ chunk, slots, isStandingImageDrawn }: { chunk: MapChunk; slots: readonly GroundTilesetSlot[]; isStandingImageDrawn: (sprite: StandingTileSprite) => boolean }): number[][] {
  const slotByDefId = new Map(slots.map((slot) => [slot.def.id, slot]));
  return Array.from({ length: CHUNK_SIZE }, (_, localRow) =>
    Array.from({ length: CHUNK_SIZE }, (_, localColumn) => {
      const defId = chunk.defIds[localRow * CHUNK_SIZE + localColumn] as number;
      if (defId === NO_TILE) return EMPTY_GROUND_TILE;
      const standingSprite = getTileDef(defId).standingSprite;
      const groundDefId = standingSprite && isStandingImageDrawn(standingSprite) ? standingSprite.groundDefId : defId;
      const slot = slotByDefId.get(groundDefId);
      if (!slot) throw new Error(`Def id ${groundDefId} has no tile in the ground tileset`);
      return slot.firstTileIndex + variantOfTile({ column: chunk.firstTile.column + localColumn, row: chunk.firstTile.row + localRow, variantCount: slot.tileCount });
    }),
  );
}
