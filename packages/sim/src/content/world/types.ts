/**
 * The world's terrain. There is one world and it only grows: it is authored
 * as areas, stored as chunks, and lives in one coordinate space whose origin
 * never moves. See docs/decisions/0013-world-as-chunks.md.
 *
 * Units in the sim are metres and the y axis points down, matching screen
 * coordinates. One tile is TILE_SIZE metres (features/terrain/defs.ts). Tile
 * (column, row) covers the metres from (column, row) to (column + 1, row + 1)
 * times TILE_SIZE, so tile (0, 0) has its top-left corner on the origin and
 * columns and rows west and north of it are negative.
 */

/** A tile of the world. Any pair of integers names one; whether an area put a tile there is another question (`tileDefIdAt`). */
export interface TileCoordinate {
  readonly column: number;
  readonly row: number;
}

/** A rectangle of tiles, in tile units. */
export interface TileRectangle {
  readonly column: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A piece of the world drawn as ASCII rows, so agents can author one in a
 * text editor, in a file of its own. It reserves the rectangle of world
 * tiles its rows cover, starting at `origin`: no other area may put a tile
 * there. Outdoors, areas sit side by side; an interior is an area mounted
 * out of the way.
 */
export interface AreaData {
  /** Unique among the areas of a map. Errors name the area by it. */
  readonly name: string;
  /** The world tile of the area's top-left character. Moving an area is changing this, never its rows. */
  readonly origin: TileCoordinate;
  /** Tile kind for each character used in `rows`: a terrain def id (features/terrain/defs.ts). */
  readonly legend: Readonly<Record<string, number>>;
  /** The area's tiles, top row first, one character per tile. Every row has the same length. */
  readonly rows: readonly string[];
}

/** The whole terrain of a world: its areas and where players appear. */
export interface WorldMap {
  readonly areas: readonly AreaData[];
  /** The world tile players appear on. It must be a walkable tile of some area. */
  readonly spawn: TileCoordinate;
}

/**
 * A square of `CHUNK_SIZE` by `CHUNK_SIZE` tiles: the unit the world is
 * stored, collided and drawn in. Chunk (column, row) holds the tile columns
 * from `column * CHUNK_SIZE` to `column * CHUNK_SIZE + CHUNK_SIZE - 1`, and
 * rows likewise.
 */
export interface MapChunk {
  readonly column: number;
  readonly row: number;
  /** The chunk's first tile: its top-left corner in world tiles. */
  readonly firstTile: TileCoordinate;
  /**
   * The tile def id of every cell, row by row:
   * `defIds[localRow * CHUNK_SIZE + localColumn]`. `NO_TILE` where no area
   * put a tile. Never written after the map was read.
   */
  readonly defIds: Uint16Array;
}

/** A map's areas resolved into chunks of tile def ids. Only chunks that hold at least one tile exist. */
export interface MapTiles {
  /** Side of one tile in metres. */
  readonly tileSize: number;
  /** Tiles along one side of a chunk. */
  readonly chunkSize: number;
  /** Every chunk, top row first, then left to right. Colliders are built in this order. */
  readonly chunks: readonly MapChunk[];
  /** The smallest rectangle of tiles that holds every area. */
  readonly bounds: TileRectangle;
  /**
   * Names the terrain: two maps with the same tiles in the same places and
   * the same spawn have the same checksum, however they are split into
   * areas. A snapshot and a server's welcome carry it.
   */
  readonly checksum: string;
}
