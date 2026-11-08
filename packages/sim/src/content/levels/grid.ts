import { getTileDef, TILE_SIZE } from '../../features/terrain/defs';
import type { LevelData, TileCoordinate, TileGrid } from './types';

/**
 * Resolves a level's ASCII rows through its legend. Levels are content, so a
 * malformed one is a bug in the repository: this throws with the level name
 * instead of guessing.
 */
export function readTileGrid(level: LevelData): TileGrid {
  const rows = level.rows.length;
  if (rows === 0) throw new Error(`Level "${level.name}" has no rows`);
  const columns = (level.rows[0] as string).length;
  if (columns === 0) throw new Error(`Level "${level.name}" has empty rows`);
  const defIdByCharacter = new Map<string, number>();
  for (const [character, defId] of Object.entries(level.legend)) {
    if (character.length !== 1) throw new Error(`Level "${level.name}": legend key "${character}" must be one character`);
    defIdByCharacter.set(character, getTileDef(defId).id);
  }
  const defIds = level.rows.map((row, rowIndex) => {
    if (row.length !== columns) {
      throw new Error(`Level "${level.name}": row ${rowIndex} has ${row.length} tiles, expected ${columns}`);
    }
    return Array.from(row, (character, columnIndex) => {
      const defId = defIdByCharacter.get(character);
      if (defId === undefined) {
        throw new Error(`Level "${level.name}": no legend entry for "${character}" at row ${rowIndex}, column ${columnIndex}`);
      }
      return defId;
    });
  });
  return { columns, rows, tileSize: TILE_SIZE, width: columns * TILE_SIZE, height: rows * TILE_SIZE, defIds };
}

/** Centre of a tile in metres, with the level centred on the origin. */
export function tileCentre(grid: TileGrid, { column, row }: TileCoordinate): { x: number; y: number } {
  return {
    x: (column + 0.5) * grid.tileSize - grid.width / 2,
    y: (row + 0.5) * grid.tileSize - grid.height / 2,
  };
}

/** The tile containing a point in metres, or undefined when the point is outside the level. */
export function tileAt(grid: TileGrid, x: number, y: number): TileCoordinate | undefined {
  const column = Math.floor((x + grid.width / 2) / grid.tileSize);
  const row = Math.floor((y + grid.height / 2) / grid.tileSize);
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return undefined;
  return { column, row };
}

/** Where players appear, in metres: the centre of the level's spawn tile. */
export function spawnPoint(level: LevelData): { x: number; y: number } {
  const grid = readTileGrid(level);
  const { column, row } = level.spawn;
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) {
    throw new Error(`Level "${level.name}": spawn (${column}, ${row}) is outside the ${grid.columns}x${grid.rows} grid`);
  }
  return tileCentre(grid, level.spawn);
}
