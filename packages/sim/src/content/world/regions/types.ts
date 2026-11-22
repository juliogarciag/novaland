import type { WorldMap } from '../types';

/** A point of the Earth, in degrees: north and east are positive. */
export interface EarthCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * How a region's tiles sit on the Earth: an equirectangular projection, so
 * a column is a fixed step of longitude and a row a fixed step of latitude.
 * The top-left corner of tile (0, 0) is at (`north`, `west`).
 */
export interface RegionGrid {
  readonly north: number;
  readonly west: number;
  readonly degreesPerColumn: number;
  readonly degreesPerRow: number;
  /** The latitude where a tile is exactly square on the ground. North of it a tile covers less ground east to west, south of it more. */
  readonly standardParallel: number;
  /** The ground one tile covers, north to south everywhere and east to west at the standard parallel. */
  readonly kilometresPerTile: number;
}

/** A dataset a region was made from, with the credit its licence asks for. */
export interface RegionSource {
  readonly name: string;
  readonly licence: string;
  readonly credit: string;
}

/**
 * A piece of the real Earth as a map: natural ground only, read from public
 * data by `pnpm region:build` (scripts/region) and committed as rows of
 * tiles like any other content. It is not part of the world players join;
 * it is played by itself to judge a scale (`VITE_REGION_MAP`, dev builds).
 */
export interface Region {
  readonly name: string;
  readonly grid: RegionGrid;
  readonly sources: readonly RegionSource[];
  readonly map: WorldMap;
}
