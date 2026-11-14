import { CHUNK_SIZE, TILE_SIZE, type TileCoordinate, type TileRectangle } from '@novaland/sim';
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

/** The chunks that hold a tile of a rectangle of tiles, such as a map's bounds. */
export function chunkRangeOfTiles({ column, row, width, height }: TileRectangle): ChunkRange {
  return {
    firstColumn: Math.floor(column / CHUNK_SIZE),
    lastColumn: Math.floor((column + width - 1) / CHUNK_SIZE),
    firstRow: Math.floor(row / CHUNK_SIZE),
    lastRow: Math.floor((row + height - 1) / CHUNK_SIZE),
  };
}

/** The part of `range` that lies inside `limit`. It holds no chunk when the two do not meet. */
export function chunkRangeWithin(range: ChunkRange, limit: ChunkRange): ChunkRange {
  return {
    firstColumn: Math.max(range.firstColumn, limit.firstColumn),
    lastColumn: Math.min(range.lastColumn, limit.lastColumn),
    firstRow: Math.max(range.firstRow, limit.firstRow),
    lastRow: Math.min(range.lastRow, limit.lastRow),
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

/**
 * What a set of drawn chunks has to change to fit a new view: the drawn
 * ones that left the `keep` range are dropped, and every chunk of the
 * `draw` range that is not drawn yet is built. Keys are "column,row".
 */
export function chunksToDropAndBuild({ drawnKeys, draw, keep }: { drawnKeys: Iterable<string>; draw: ChunkRange; keep: ChunkRange }): { drop: string[]; build: TileCoordinate[] } {
  const drawn = new Set(drawnKeys);
  const drop = [...drawn].filter((key) => !isInChunkRange(keep, chunkCoordinateFromKey(key)));
  const build = chunkCoordinatesIn(draw).filter((coordinate) => !drawn.has(chunkKey(coordinate)));
  return { drop, build };
}

export function chunkKey({ column, row }: TileCoordinate): string {
  return `${column},${row}`;
}

function chunkCoordinateFromKey(key: string): TileCoordinate {
  const [column, row] = key.split(',').map(Number) as [number, number];
  return { column, row };
}

export function sameChunkRange(first: ChunkRange, second: ChunkRange): boolean {
  return first.firstColumn === second.firstColumn && first.lastColumn === second.lastColumn && first.firstRow === second.firstRow && first.lastRow === second.lastRow;
}
