import { query } from 'bitecs';
import { readMapTiles, tileAt, tileCentre, tileDefIdAt, WORLD_LIMIT_TILES } from '../../content/world/tiles';
import type { MapTiles, TileCoordinate } from '../../content/world/types';
import type { Sim } from '../../core/sim';
import { Position } from '../../core/transform';
import { getTileDef, TILE_SIZE } from '../terrain/defs';
import { Player } from './components';

/** How many tiles out from the spawn tile a free tile is looked for. Far more room than every seat needs. */
const SPAWN_SEARCH_RINGS = 32;

/**
 * Where a joining player appears, in metres: the centre of a free tile as
 * close to the map's spawn tile as possible. Tiles are searched in square
 * rings around the spawn tile; the first ring with any free tile wins and one
 * of its free tiles is picked with the sim's rng, so five arrivals spread
 * around the spawn instead of forming a queue. A tile is free when it is
 * walkable and no player stands on it. The search stops `SPAWN_SEARCH_RINGS`
 * tiles out: with no free tile that close (a spawn so crowded or so walled
 * in) the player appears on the spawn tile itself. Players pass through each
 * other, so a pile-up is only cosmetic, and a join must stay cheap however
 * big the map is: it runs inside a command handler.
 */
export function pickSpawnPoint(sim: Sim): { x: number; y: number } {
  const tiles = readMapTiles(sim.map);
  const occupied = occupiedTileKeys(sim);
  for (let ring = 0; ring <= SPAWN_SEARCH_RINGS; ring += 1) {
    const free = ringTiles(sim.map.spawn, ring).filter((tile) => isWalkable(tiles, tile) && !occupied.has(tileKey(tile)));
    if (free.length > 0) return tileCentre(free[sim.rng.nextInt(free.length)] as TileCoordinate);
  }
  return tileCentre(sim.map.spawn);
}

/** How many tiles out from the tile a returning player left a free tile is looked for; with none that close the player spawns as a new one. */
const RETURN_SEARCH_RINGS = 8;

/**
 * Where a returning player appears, in metres: the point they left when its
 * tile is still free, else the centre of the free tile nearest to that point
 * (the map may have changed since, or someone may be standing there).
 * Undefined when the point is not finite, lies past the world's limit, or no tile within
 * `RETURN_SEARCH_RINGS` of it is free: the caller spawns the player as new.
 * Nothing here is random, and the search is the same few hundred tiles
 * however big the map is.
 */
export function pickReturnPoint(sim: Sim, leftAt: { readonly x: number; readonly y: number }): { x: number; y: number } | undefined {
  const leftTile = tileAt(leftAt.x, leftAt.y);
  // No area reaches past the world's limit, and tile numbers that large stop counting up one by one: the rings below would never end.
  if (!leftTile || Math.abs(leftTile.column) > WORLD_LIMIT_TILES || Math.abs(leftTile.row) > WORLD_LIMIT_TILES) return undefined;
  const tiles = readMapTiles(sim.map);
  const occupied = occupiedTileKeys(sim);
  const isFree = (tile: TileCoordinate): boolean => isWalkable(tiles, tile) && !occupied.has(tileKey(tile));
  if (isFree(leftTile)) return { x: leftAt.x, y: leftAt.y };
  let nearest: { x: number; y: number } | undefined;
  let nearestDistance = Infinity;
  for (let ring = 1; ring <= RETURN_SEARCH_RINGS; ring += 1) {
    for (const tile of ringTiles(leftTile, ring)) {
      if (!isFree(tile)) continue;
      const centre = tileCentre(tile);
      const distance = Math.hypot(centre.x - leftAt.x, centre.y - leftAt.y);
      if (distance < nearestDistance) {
        nearest = centre;
        nearestDistance = distance;
      }
    }
    // A tile of a later ring is at least `ring` tiles minus the half tile the point may be off its own centre away.
    if (nearestDistance <= (ring + 0.5) * TILE_SIZE) break;
  }
  return nearest;
}

/** Tiles at Chebyshev distance `ring` from `centre`, top row first and left to right. Ring 0 is the centre itself. */
function ringTiles(centre: TileCoordinate, ring: number): TileCoordinate[] {
  const tiles: TileCoordinate[] = [];
  for (let row = centre.row - ring; row <= centre.row + ring; row += 1) {
    const onTopOrBottomEdge = Math.abs(row - centre.row) === ring;
    const step = onTopOrBottomEdge || ring === 0 ? 1 : 2 * ring;
    for (let column = centre.column - ring; column <= centre.column + ring; column += step) tiles.push({ column, row });
  }
  return tiles;
}

/** True when an area put a tile there and it is not solid. */
function isWalkable(tiles: MapTiles, tile: TileCoordinate): boolean {
  const defId = tileDefIdAt(tiles, tile);
  return defId !== undefined && !getTileDef(defId).solid;
}

/** Keys of the tiles with a player standing on them (by the centre of their body). */
function occupiedTileKeys(sim: Sim): ReadonlySet<string> {
  const player = sim.store(Player);
  const position = sim.store(Position);
  const occupied = new Set<string>();
  for (const eid of query(sim.world, [player, position])) {
    const tile = tileAt(position.x[eid] as number, position.y[eid] as number);
    if (tile) occupied.add(tileKey(tile));
  }
  return occupied;
}

function tileKey({ column, row }: TileCoordinate): string {
  return `${column},${row}`;
}
