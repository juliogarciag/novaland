import { CHUNK_SIZE, TILE_SIZE, type TileCoordinate } from '@novaland/sim';
import { toPixels } from './units';

/**
 * A standing image may overhang its tile: a tree is two tiles tall, so it
 * reaches a tile north of its own. A chunk is drawn while any of its tiles
 * is within this many tiles of what the camera shows, which keeps an image
 * rooted just off screen from popping in late. A test checks it against
 * every standing sprite of the terrain defs.
 */
export const DRAW_MARGIN_TILES = 2;

/**
 * A drawn chunk is kept until all of its tiles are this far from what the
 * camera shows. Further than the draw margin, so that walking back and
 * forth over a chunk edge does not build and drop the same chunks again
 * and again.
 */
export const KEEP_MARGIN_TILES = DRAW_MARGIN_TILES + CHUNK_SIZE / 2;

/** A rectangle in world pixels. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A block of chunks, by chunk coordinates, both ends included. */
export interface ChunkRange {
  readonly firstColumn: number;
  readonly lastColumn: number;
  readonly firstRow: number;
  readonly lastRow: number;
}

/** The chunks that hold a tile within `marginTiles` of a rectangle of the world, such as what the camera shows. */
export function chunkRangeAround(view: PixelRect, marginTiles: number): ChunkRange {
  const chunkPixels = toPixels(CHUNK_SIZE * TILE_SIZE);
  const marginPixels = toPixels(marginTiles * TILE_SIZE);
  return {
    firstColumn: Math.floor((view.x - marginPixels) / chunkPixels),
    lastColumn: Math.floor((view.x + view.width + marginPixels) / chunkPixels),
    firstRow: Math.floor((view.y - marginPixels) / chunkPixels),
    lastRow: Math.floor((view.y + view.height + marginPixels) / chunkPixels),
  };
}

export function isInChunkRange(range: ChunkRange, { column, row }: TileCoordinate): boolean {
  return column >= range.firstColumn && column <= range.lastColumn && row >= range.firstRow && row <= range.lastRow;
}

/** The chunk coordinates of a range, top row first, left to right. */
export function chunkCoordinatesIn(range: ChunkRange): TileCoordinate[] {
  const coordinates: TileCoordinate[] = [];
  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    for (let column = range.firstColumn; column <= range.lastColumn; column += 1) coordinates.push({ column, row });
  }
  return coordinates;
}

export function sameChunkRange(first: ChunkRange, second: ChunkRange): boolean {
  return first.firstColumn === second.firstColumn && first.lastColumn === second.lastColumn && first.firstRow === second.firstRow && first.lastRow === second.lastRow;
}
