import { getTileDef } from '../../../features/terrain/defs';
import { readMapTiles, tileDefIdAt } from '../tiles';
import type { TileCoordinate, WorldMap } from '../types';
import { alps } from './alps';
import type { EarthCoordinates, Region } from './types';

/** Every region there is, by name. A new one is a file written by `pnpm region:build` and one line here. */
export const regions: Readonly<Record<string, Region>> = { alps };

/** How far from a point `regionMapSpawningNear` looks for walkable ground, in tiles: enough to get out of the middle of the widest lake or ice field. */
const SPAWN_SEARCH_RINGS = 48;

/** The tile of a region a point of the Earth falls in, or undefined when the point is not finite or outside the region. */
export function tileOfCoordinates(region: Region, { latitude, longitude }: EarthCoordinates): TileCoordinate | undefined {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  const tile = { column: Math.floor((longitude - region.grid.west) / region.grid.degreesPerColumn), row: Math.floor((region.grid.north - latitude) / region.grid.degreesPerRow) };
  return tileDefIdAt(readMapTiles(region.map), tile) === undefined ? undefined : tile;
}

/**
 * The region's map with players appearing on the walkable tile nearest to a
 * point of the Earth instead of on its own spawn, to start a walk anywhere.
 * Throws when the point is outside the region or has no walkable ground near it.
 */
export function regionMapSpawningNear(region: Region, coordinates: EarthCoordinates): WorldMap {
  const centre = tileOfCoordinates(region, coordinates);
  if (!centre) throw new Error(`(${coordinates.latitude}, ${coordinates.longitude}) is outside the region "${region.name}"`);
  const tiles = readMapTiles(region.map);
  for (let ring = 0; ring <= SPAWN_SEARCH_RINGS; ring += 1) {
    for (let row = centre.row - ring; row <= centre.row + ring; row += 1) {
      for (let column = centre.column - ring; column <= centre.column + ring; column += 1) {
        if (Math.max(Math.abs(row - centre.row), Math.abs(column - centre.column)) !== ring) continue;
        const defId = tileDefIdAt(tiles, { column, row });
        if (defId !== undefined && !getTileDef(defId).solid) return { areas: region.map.areas, spawn: { column, row } };
      }
    }
  }
  throw new Error(`No walkable tile within ${SPAWN_SEARCH_RINGS} tiles of (${coordinates.latitude}, ${coordinates.longitude}) in the region "${region.name}"`);
}
