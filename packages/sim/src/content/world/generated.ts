import { TerrainDefId } from '../../features/terrain/defs';
import type { WorldMap } from './types';

export interface GeneratedMapOptions {
  /** Size of the map in tiles. Both at least 8, so there is room inside the forest for a spawn. */
  readonly columns: number;
  readonly rows: number;
}

/**
 * A map made by rule, for measurements and tests of big worlds: one area
 * with a forest two tiles thick around the edge and trees and rocks
 * scattered inside it (about one tile in thirty-three is solid). The same
 * size always gives the same map. It is never the world players join; that
 * one is authored (`worldMap`).
 */
export function generatedWorldMap({ columns, rows }: GeneratedMapOptions): WorldMap {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 8 || rows < 8) {
    throw new RangeError(`A generated map needs at least 8x8 tiles, got ${String(columns)}x${String(rows)}`);
  }
  let state = (columns * 73856093) ^ (rows * 19349663);
  const nextRoll = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const areaRows: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    let text = '';
    for (let column = 0; column < columns; column += 1) {
      const onEdge = row < 2 || column < 2 || row >= rows - 2 || column >= columns - 2;
      const roll = nextRoll();
      text += onEdge || roll < 0.02 ? 'T' : roll < 0.03 ? 'o' : '.';
    }
    areaRows.push(text);
  }
  return {
    areas: [{ name: `generated-${columns}x${rows}`, origin: { column: 0, row: 0 }, legend: { T: TerrainDefId.Tree, '.': TerrainDefId.Grass, o: TerrainDefId.Rock }, rows: areaRows }],
    spawn: walkableTileNearestCentre(areaRows),
  };
}

function walkableTileNearestCentre(areaRows: readonly string[]): { column: number; row: number } {
  const centre = { column: Math.floor((areaRows[0] as string).length / 2), row: Math.floor(areaRows.length / 2) };
  for (let ring = 0; ring < areaRows.length; ring += 1) {
    for (let row = centre.row - ring; row <= centre.row + ring; row += 1) {
      for (let column = centre.column - ring; column <= centre.column + ring; column += 1) {
        if (areaRows[row]?.[column] === '.') return { column, row };
      }
    }
  }
  throw new Error('The generated map has no walkable tile');
}
