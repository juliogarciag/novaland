/**
 * Which variant of its art a tile shows: scattered so neighbours rarely
 * match, and the same for a tile every time, so the world does not change
 * between visits or between two players looking at it. Looks only: the sim
 * knows nothing of it.
 */
export function variantOfTile({ column, row, variantCount }: { column: number; row: number; variantCount: number }): number {
  let hash = (Math.imul(column, 374761393) + Math.imul(row, 668265263)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) % variantCount;
}
