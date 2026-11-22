/**
 * Geometry on the tile grid: which tiles a line crosses and whether a point
 * is inside a polygon. Positions are in tiles and fractions of a tile.
 */

/**
 * Every tile the straight line from `from` to `to` passes through, in order,
 * both ends included. Each tile shares a side with the next, never only a
 * corner, so a river drawn with it has no gap a player could slip through
 * diagonally and reads as one line.
 */
export function tilesAlongSegment(from, to) {
  let column = Math.floor(from.column);
  let row = Math.floor(from.row);
  const lastColumn = Math.floor(to.column);
  const lastRow = Math.floor(to.row);
  const columnDistance = to.column - from.column;
  const rowDistance = to.row - from.row;
  const columnStep = Math.sign(lastColumn - column);
  const rowStep = Math.sign(lastRow - row);
  // How far along the line (0 at `from`, 1 at `to`) the next tile edge is crossed on each axis, and how far apart those crossings are.
  let nextColumnEdge = columnStep === 0 ? Infinity : ((columnStep > 0 ? column + 1 : column) - from.column) / columnDistance;
  let nextRowEdge = rowStep === 0 ? Infinity : ((rowStep > 0 ? row + 1 : row) - from.row) / rowDistance;
  const columnEdgeSpacing = columnStep === 0 ? Infinity : Math.abs(1 / columnDistance);
  const rowEdgeSpacing = rowStep === 0 ? Infinity : Math.abs(1 / rowDistance);
  const tiles = [{ column, row }];
  const steps = Math.abs(lastColumn - column) + Math.abs(lastRow - row);
  for (let step = 0; step < steps; step += 1) {
    const stepAlongColumns = row === lastRow || (column !== lastColumn && nextColumnEdge < nextRowEdge);
    if (stepAlongColumns) {
      column += columnStep;
      nextColumnEdge += columnEdgeSpacing;
    } else {
      row += rowStep;
      nextRowEdge += rowEdgeSpacing;
    }
    tiles.push({ column, row });
  }
  return tiles;
}

/**
 * Whether a point is inside a polygon given as GeoJSON does: `rings` is the
 * outer ring followed by the holes, each a list of positions, here already
 * in tiles. A point in a hole is outside.
 */
export function isInsidePolygon(rings, { column, row }) {
  let inside = false;
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const start = ring[index];
      const end = ring[previous];
      if (start.row > row !== end.row > row && column < ((end.column - start.column) * (row - start.row)) / (end.row - start.row) + start.column) inside = !inside;
    }
  }
  return inside;
}
