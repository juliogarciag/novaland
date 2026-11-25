import { CHUNK_SIZE, EDGE_SHAPES, EdgeNeighbour, edgeShapeOf, getTileDef, NO_TILE, type GroundTileSprite, type MapChunk, type StandingTileSprite, type TileCoordinate, type TileDef } from '@novaland/sim';
import { variantOfTile } from './tileVariant';

/** Side of one tile of the ground tileset in texture pixels. A ground sprite's tiles must be this size. */
export const GROUND_TILE_PIXELS = 16;

/**
 * The tiles one def owns in the ground tileset: `tileCount` of them in a
 * row starting at `firstTileIndex`. With a `groundSprite` they are the
 * tiles of its sheet, in sheet order: `variantCount` variants, then, for a
 * sprite with `edgeTiles`, one tile per edge shape. Without, the def owns
 * one tile, flat in its colour.
 */
export interface GroundTilesetSlot {
  readonly def: TileDef;
  readonly firstTileIndex: number;
  readonly tileCount: number;
  /** How many of the slot's tiles, counted from the first, are variants to pick among. */
  readonly variantCount: number;
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
    const variantCount = groundSprite ? groundSprite.variantCount : 1;
    const tileCount = variantCount + (groundSprite?.edgeTiles ? EDGE_SHAPES.length : 0);
    slots.push({ def, firstTileIndex, tileCount, variantCount, ...(groundSprite ? { groundSprite } : {}) });
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
 * it is drawn with. A def with edge tiles shows one of them wherever a tile
 * around it is not the same surface: `defIdAt` says what is at any tile of
 * the world, the chunks next door included, and `undefined` where nothing is.
 */
export function groundTileIndexRows({
  chunk,
  slots,
  isStandingImageDrawn,
  defIdAt,
}: {
  chunk: MapChunk;
  slots: readonly GroundTilesetSlot[];
  isStandingImageDrawn: (sprite: StandingTileSprite) => boolean;
  defIdAt: (tile: TileCoordinate) => number | undefined;
}): number[][] {
  const slotByDefId = new Map(slots.map((slot) => [slot.def.id, slot]));
  return Array.from({ length: CHUNK_SIZE }, (_, localRow) =>
    Array.from({ length: CHUNK_SIZE }, (_, localColumn) => {
      const defId = chunk.defIds[localRow * CHUNK_SIZE + localColumn] as number;
      if (defId === NO_TILE) return EMPTY_GROUND_TILE;
      const standingSprite = getTileDef(defId).standingSprite;
      const groundDefId = standingSprite && isStandingImageDrawn(standingSprite) ? standingSprite.groundDefId : defId;
      const slot = slotByDefId.get(groundDefId);
      if (!slot) throw new Error(`Def id ${groundDefId} has no tile in the ground tileset`);
      const tile = { column: chunk.firstTile.column + localColumn, row: chunk.firstTile.row + localRow };
      const edgeTile = edgeTileOf({ tile, slot, defIdAt });
      return slot.firstTileIndex + (edgeTile ?? variantOfTile({ ...tile, variantCount: slot.variantCount }));
    }),
  );
}

/** The eight tiles around a tile: how far across and down each is, and its bit in an edge shape. */
const NEIGHBOURS = [
  { columns: 0, rows: -1, bit: EdgeNeighbour.North },
  { columns: 1, rows: 0, bit: EdgeNeighbour.East },
  { columns: 0, rows: 1, bit: EdgeNeighbour.South },
  { columns: -1, rows: 0, bit: EdgeNeighbour.West },
  { columns: 1, rows: -1, bit: EdgeNeighbour.NorthEast },
  { columns: 1, rows: 1, bit: EdgeNeighbour.SouthEast },
  { columns: -1, rows: 1, bit: EdgeNeighbour.SouthWest },
  { columns: -1, rows: -1, bit: EdgeNeighbour.NorthWest },
] as const;

/**
 * Which tile of its slot shows the edge a tile has, counted from the slot's
 * first tile; `undefined` for a tile with no edge to show: its slot has no
 * edge tiles, or every tile around it is the same surface.
 */
function edgeTileOf({ tile, slot, defIdAt }: { tile: TileCoordinate; slot: GroundTilesetSlot; defIdAt: (tile: TileCoordinate) => number | undefined }): number | undefined {
  const edgeTiles = slot.groundSprite?.edgeTiles;
  if (!edgeTiles) return undefined;
  let sameSurfaceNeighbours = 0;
  for (const neighbour of NEIGHBOURS) {
    const defId = defIdAt({ column: tile.column + neighbour.columns, row: tile.row + neighbour.rows });
    if (defId !== undefined && edgeTiles.sameSurfaceDefIds.includes(defId)) sameSurfaceNeighbours |= neighbour.bit;
  }
  const edgeShapeIndex = EDGE_SHAPES.indexOf(edgeShapeOf(sameSurfaceNeighbours));
  return edgeShapeIndex < 0 ? undefined : slot.variantCount + edgeShapeIndex;
}
