/**
 * Level data. A level is a grid of tiles drawn as ASCII rows, so agents can
 * author one in a text editor. Units in the sim are metres; the origin is the
 * centre of the level and the y axis points down, matching screen
 * coordinates. One tile is TILE_SIZE metres (features/terrain/defs.ts).
 * See docs/decisions/0003-levels-as-tiles.md.
 */
export interface LevelData {
  readonly name: string;
  /** Tile kind for each character used in `rows`: a terrain def id (features/terrain/defs.ts). */
  readonly legend: Readonly<Record<string, number>>;
  /** The grid, top row first, one character per tile. Every row has the same length. */
  readonly rows: readonly string[];
  /** The tile players appear on. Column 0 is the left edge, row 0 the top. */
  readonly spawn: TileCoordinate;
}

export interface TileCoordinate {
  readonly column: number;
  readonly row: number;
}

/** A level's rows and legend resolved into tile def ids, with its size in metres. */
export interface TileGrid {
  readonly columns: number;
  readonly rows: number;
  /** Side of one tile in metres. */
  readonly tileSize: number;
  /** Size in metres. */
  readonly width: number;
  readonly height: number;
  /** `defIds[row][column]` is the tile def id at that cell. */
  readonly defIds: readonly (readonly number[])[];
}
