import type { TileGrid } from '../../content/levels/types';
import { getTileDef } from './defs';

/** A rectangle of solid tiles, in tile units. */
export interface TileRectangle {
  readonly column: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The solid tiles of a grid covered by as few rectangles as a two-pass merge
 * gives: horizontal runs first, so a 40-tile row of trees is one box, then
 * runs stacked on identical runs below them, so a 3-tile-thick border is one
 * box per side. Rectangles never overlap. The order is by row, then column,
 * so the same grid always produces the same entities in the same order.
 */
export function solidRectangles(grid: TileGrid): TileRectangle[] {
  const rectangles: TileRectangle[] = [];
  /** Rectangles whose bottom edge is the row above the one being scanned, by start column. */
  let openAbove = new Map<number, number>();
  for (let row = 0; row < grid.rows; row += 1) {
    const openHere = new Map<number, number>();
    for (const run of solidRuns(grid, row)) {
      const indexAbove = openAbove.get(run.column);
      const above = indexAbove === undefined ? undefined : rectangles[indexAbove];
      if (above && above.width === run.width) {
        rectangles[indexAbove as number] = { ...above, height: above.height + 1 };
        openHere.set(run.column, indexAbove as number);
      } else {
        openHere.set(run.column, rectangles.length);
        rectangles.push({ column: run.column, row, width: run.width, height: 1 });
      }
    }
    openAbove = openHere;
  }
  return rectangles.sort((a, b) => a.row - b.row || a.column - b.column);
}

/** Maximal horizontal runs of solid tiles in one row. */
function solidRuns(grid: TileGrid, row: number): Array<{ column: number; width: number }> {
  const runs: Array<{ column: number; width: number }> = [];
  const cells = grid.defIds[row] as readonly number[];
  let start = -1;
  for (let column = 0; column <= grid.columns; column += 1) {
    const solid = column < grid.columns && getTileDef(cells[column] as number).solid;
    if (solid && start < 0) start = column;
    if (!solid && start >= 0) {
      runs.push({ column: start, width: column - start });
      start = -1;
    }
  }
  return runs;
}
