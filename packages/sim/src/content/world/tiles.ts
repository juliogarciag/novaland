import { getTileDef, TILE_SIZE } from '../../features/terrain/defs';
import type { AreaData, MapChunk, MapTiles, TileCoordinate, TileRectangle, WorldMap } from './types';

/** Tiles along one side of a chunk. */
export const CHUNK_SIZE = 32;

/**
 * No area may reach further than this many tiles from the origin, in any
 * direction. Rapier keeps positions as 32-bit floats: this far out they are
 * still exact to about a millimetre, and beyond it movement starts to lose
 * precision. An interior mounted "out of the way" belongs well inside it.
 */
export const WORLD_LIMIT_TILES = 16384;

/** What a chunk holds where no area put a tile. No def has this id. */
export const NO_TILE = 0;

/** Tiles are derived from a map, never changed, so each map object is read once. */
const tilesByMap = new WeakMap<WorldMap, MapTiles>();
const chunkByKeyByTiles = new WeakMap<MapTiles, ReadonlyMap<string, MapChunk>>();

/**
 * Resolves a map's areas into chunks of tile def ids. A map is content, so a
 * malformed one is a bug in the repository: this throws, naming the area,
 * instead of guessing. That covers ragged rows, a character with no legend
 * entry, a def that is not a tile, an origin that is not a tile, an area
 * further than `WORLD_LIMIT_TILES` from the origin, two areas that reserve
 * the same tile, and a spawn that is not on a walkable tile.
 * The terrain feature calls it when the sim is created, so a bad map never
 * gets as far as a command handler.
 */
export function readMapTiles(map: WorldMap): MapTiles {
  const known = tilesByMap.get(map);
  if (known) return known;
  const tiles = buildMapTiles(map);
  tilesByMap.set(map, tiles);
  return tiles;
}

/** The chunk at these chunk coordinates, or undefined when no area put a tile in it. */
export function findChunk(tiles: MapTiles, { column, row }: TileCoordinate): MapChunk | undefined {
  return chunkByKeyByTiles.get(tiles)?.get(chunkKey(column, row));
}

/** The chunk coordinates of the chunk that holds a tile. */
export function chunkCoordinateOf({ column, row }: TileCoordinate): TileCoordinate {
  return { column: Math.floor(column / CHUNK_SIZE), row: Math.floor(row / CHUNK_SIZE) };
}

/** The tile def id at a world tile, or undefined where no area put a tile. */
export function tileDefIdAt(tiles: MapTiles, { column, row }: TileCoordinate): number | undefined {
  if (!Number.isInteger(column) || !Number.isInteger(row)) return undefined;
  const chunk = findChunk(tiles, chunkCoordinateOf({ column, row }));
  if (!chunk) return undefined;
  const defId = chunk.defIds[(row - chunk.firstTile.row) * CHUNK_SIZE + (column - chunk.firstTile.column)] as number;
  return defId === NO_TILE ? undefined : defId;
}

/** Centre of a world tile in metres. */
export function tileCentre({ column, row }: TileCoordinate): { x: number; y: number } {
  return { x: (column + 0.5) * TILE_SIZE, y: (row + 0.5) * TILE_SIZE };
}

/** The world tile containing a point in metres, or undefined when the point is not finite. */
export function tileAt(x: number, y: number): TileCoordinate | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
}

/** Where players appear, in metres: the centre of the map's spawn tile. */
export function spawnPoint(map: WorldMap): { x: number; y: number } {
  readMapTiles(map);
  return tileCentre(map.spawn);
}

function buildMapTiles(map: WorldMap): MapTiles {
  if (map.areas.length === 0) throw new Error('The map has no areas');
  const reserved = map.areas.map((area) => ({ area, rectangle: reservedRectangle(area) }));
  for (let index = 0; index < reserved.length; index += 1) {
    for (let other = 0; other < index; other += 1) {
      const first = reserved[other] as (typeof reserved)[number];
      const second = reserved[index] as (typeof reserved)[number];
      if (first.area.name === second.area.name) throw new Error(`Two areas are named "${first.area.name}"`);
      if (rectanglesOverlap(first.rectangle, second.rectangle)) {
        throw new Error(`Areas "${first.area.name}" and "${second.area.name}" overlap: each tile belongs to one area`);
      }
    }
  }
  const chunkByKey = new Map<string, MapChunk>();
  for (const { area, rectangle } of reserved) writeAreaIntoChunks(area, rectangle, chunkByKey);
  const chunks = [...chunkByKey.values()].sort((a, b) => a.row - b.row || a.column - b.column);
  const tiles: MapTiles = {
    tileSize: TILE_SIZE,
    chunkSize: CHUNK_SIZE,
    chunks,
    bounds: boundsOf(reserved.map(({ rectangle }) => rectangle)),
    checksum: checksumOf(chunks, map.spawn),
  };
  chunkByKeyByTiles.set(tiles, chunkByKey);
  const { column, row } = map.spawn;
  const spawnDefId = tileDefIdAt(tiles, map.spawn);
  if (spawnDefId === undefined) throw new Error(`The spawn (${column}, ${row}) is not on a tile of any area`);
  if (getTileDef(spawnDefId).solid) throw new Error(`The spawn (${column}, ${row}) is on a solid tile`);
  return tiles;
}

/** The world tiles an area's rows cover. Throws for an area whose rows or origin cannot be placed. */
function reservedRectangle(area: AreaData): TileRectangle {
  const height = area.rows.length;
  if (height === 0) throw new Error(`Area "${area.name}" has no rows`);
  const width = (area.rows[0] as string).length;
  if (width === 0) throw new Error(`Area "${area.name}" has empty rows`);
  const { column, row } = area.origin;
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) {
    throw new Error(`Area "${area.name}": origin (${column}, ${row}) is not a tile`);
  }
  if (Math.min(column, row) < -WORLD_LIMIT_TILES || Math.max(column + width, row + height) > WORLD_LIMIT_TILES) {
    throw new Error(`Area "${area.name}" reaches further than ${WORLD_LIMIT_TILES} tiles from the origin`);
  }
  return { column, row, width, height };
}

function writeAreaIntoChunks(area: AreaData, rectangle: TileRectangle, chunkByKey: Map<string, MapChunk>): void {
  const defIdByCharacter = new Map<string, number>();
  for (const [character, defId] of Object.entries(area.legend)) {
    if (character.length !== 1) throw new Error(`Area "${area.name}": legend key "${character}" must be one character`);
    defIdByCharacter.set(character, getTileDef(defId).id);
  }
  area.rows.forEach((text, rowIndex) => {
    if (text.length !== rectangle.width) {
      throw new Error(`Area "${area.name}": row ${rowIndex} has ${text.length} tiles, expected ${rectangle.width}`);
    }
    for (let columnIndex = 0; columnIndex < rectangle.width; columnIndex += 1) {
      const defId = defIdByCharacter.get(text[columnIndex] as string);
      if (defId === undefined) {
        throw new Error(`Area "${area.name}": no legend entry for "${text[columnIndex]}" at row ${rowIndex}, column ${columnIndex}`);
      }
      const tile = { column: rectangle.column + columnIndex, row: rectangle.row + rowIndex };
      const chunk = chunkHolding(tile, chunkByKey);
      chunk.defIds[(tile.row - chunk.firstTile.row) * CHUNK_SIZE + (tile.column - chunk.firstTile.column)] = defId;
    }
  });
}

/** The chunk that holds a tile, created empty when this is its first tile. */
function chunkHolding(tile: TileCoordinate, chunkByKey: Map<string, MapChunk>): MapChunk {
  const { column, row } = chunkCoordinateOf(tile);
  const key = chunkKey(column, row);
  let chunk = chunkByKey.get(key);
  if (!chunk) {
    chunk = { column, row, firstTile: { column: column * CHUNK_SIZE, row: row * CHUNK_SIZE }, defIds: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE) };
    chunkByKey.set(key, chunk);
  }
  return chunk;
}

function chunkKey(column: number, row: number): string {
  return `${column},${row}`;
}

function rectanglesOverlap(first: TileRectangle, second: TileRectangle): boolean {
  return (
    first.column < second.column + second.width &&
    second.column < first.column + first.width &&
    first.row < second.row + second.height &&
    second.row < first.row + first.height
  );
}

function boundsOf(rectangles: readonly TileRectangle[]): TileRectangle {
  const left = Math.min(...rectangles.map((rectangle) => rectangle.column));
  const top = Math.min(...rectangles.map((rectangle) => rectangle.row));
  const right = Math.max(...rectangles.map((rectangle) => rectangle.column + rectangle.width));
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.row + rectangle.height));
  return { column: left, row: top, width: right - left, height: bottom - top };
}

/**
 * 32-bit FNV-1a over the spawn and every chunk's coordinates and def ids, as
 * 8 hex chars. Chunks come sorted and hold the tiles wherever their areas
 * were cut, so the same terrain always gives the same checksum.
 */
function checksumOf(chunks: readonly MapChunk[], spawn: TileCoordinate): string {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    // Coordinates may be negative or beyond 16 bits: mix the low 32 bits, a byte at a time.
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  mix(spawn.column);
  mix(spawn.row);
  for (const chunk of chunks) {
    mix(chunk.column);
    mix(chunk.row);
    for (const defId of chunk.defIds) mix(defId);
  }
  return hash.toString(16).padStart(8, '0');
}
