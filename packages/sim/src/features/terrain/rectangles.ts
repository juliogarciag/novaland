import { CHUNK_SIZE, NO_TILE } from '../../content/world/tiles';
import type { MapChunk, TileRectangle } from '../../content/world/types';
import { getTileDef } from './defs';

/**
 * The solid tiles of a chunk covered by as few rectangles as a two-pass merge
 * gives: horizontal runs first, so a row of trees is one box, then runs
 * stacked on identical runs below them, so a thick border is one box per
 * side. Rectangles never overlap and never leave the chunk: a wall that
 * crosses into the next chunk is one rectangle in each. They are in world
 * tiles, ordered by row, then column, so the same chunk always produces the
 * same colliders in the same order.
 */
export function solidRectangles(chunk: MapChunk): TileRectangle[] {
  const rectangles: TileRectangle[] = [];
  /** Rectangles whose bottom edge is the row above the one being scanned, by start column. */
  let openAbove = new Map<number, number>();
  for (let localRow = 0; localRow < CHUNK_SIZE; localRow += 1) {
    const openHere = new Map<number, number>();
    for (const run of solidRuns(chunk, localRow)) {
      const indexAbove = openAbove.get(run.column);
      const above = indexAbove === undefined ? undefined : rectangles[indexAbove];
      if (above && above.width === run.width) {
        rectangles[indexAbove as number] = { ...above, height: above.height + 1 };
        openHere.set(run.column, indexAbove as number);
      } else {
        openHere.set(run.column, rectangles.length);
        rectangles.push({ column: run.column, row: chunk.firstTile.row + localRow, width: run.width, height: 1 });
      }
    }
    openAbove = openHere;
  }
  return rectangles.sort((a, b) => a.row - b.row || a.column - b.column);
}

/** Maximal horizontal runs of solid tiles in one row of a chunk, in world columns. */
function solidRuns(chunk: MapChunk, localRow: number): Array<{ column: number; width: number }> {
  const runs: Array<{ column: number; width: number }> = [];
  let start = -1;
  for (let localColumn = 0; localColumn <= CHUNK_SIZE; localColumn += 1) {
    const defId = localColumn < CHUNK_SIZE ? (chunk.defIds[localRow * CHUNK_SIZE + localColumn] as number) : NO_TILE;
    const solid = defId !== NO_TILE && getTileDef(defId).solid;
    if (solid && start < 0) start = localColumn;
    if (!solid && start >= 0) {
      runs.push({ column: chunk.firstTile.column + start, width: localColumn - start });
      start = -1;
    }
  }
  return runs;
}
