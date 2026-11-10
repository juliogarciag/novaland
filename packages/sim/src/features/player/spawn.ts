import { query } from 'bitecs';
import { readTileGrid, tileAt, tileCentre } from '../../content/levels/grid';
import type { TileCoordinate, TileGrid } from '../../content/levels/types';
import type { Sim } from '../../core/sim';
import { Position } from '../../core/transform';
import { getTileDef } from '../terrain/defs';
import { Player } from './components';

/**
 * Where a joining player appears, in metres: the centre of a free tile as
 * close to the level's spawn tile as possible. Tiles are searched in square
 * rings around the spawn tile; the first ring with any free tile wins and one
 * of its free tiles is picked with the sim's rng, so five arrivals spread
 * around the spawn instead of forming a queue. A tile is free when it is
 * walkable and no player stands on it. A level so crowded that no tile is
 * free (every walkable tile taken) falls back to the spawn tile itself:
 * players pass through each other, so a pile-up is only cosmetic.
 */
export function pickSpawnPoint(sim: Sim): { x: number; y: number } {
  const grid = readTileGrid(sim.level);
  const occupied = occupiedTileKeys(sim, grid);
  const farthestRing = Math.max(grid.columns, grid.rows);
  for (let ring = 0; ring <= farthestRing; ring += 1) {
    const free = ringTiles(grid, sim.level.spawn, ring).filter((tile) => isWalkable(grid, tile) && !occupied.has(tileKey(grid, tile)));
    if (free.length > 0) return tileCentre(grid, free[sim.rng.nextInt(free.length)] as TileCoordinate);
  }
  return tileCentre(grid, sim.level.spawn);
}

/** Tiles at Chebyshev distance `ring` from `centre`, inside the grid, top row first and left to right. Ring 0 is the centre itself. */
function ringTiles(grid: TileGrid, centre: TileCoordinate, ring: number): TileCoordinate[] {
  const tiles: TileCoordinate[] = [];
  for (let row = centre.row - ring; row <= centre.row + ring; row += 1) {
    if (row < 0 || row >= grid.rows) continue;
    const onTopOrBottomEdge = Math.abs(row - centre.row) === ring;
    const step = onTopOrBottomEdge || ring === 0 ? 1 : 2 * ring;
    for (let column = centre.column - ring; column <= centre.column + ring; column += step) {
      if (column >= 0 && column < grid.columns) tiles.push({ column, row });
    }
  }
  return tiles;
}

function isWalkable(grid: TileGrid, { column, row }: TileCoordinate): boolean {
  return !getTileDef((grid.defIds[row] as readonly number[])[column] as number).solid;
}

/** Keys of the tiles with a player standing on them (by the centre of their body). */
function occupiedTileKeys(sim: Sim, grid: TileGrid): ReadonlySet<number> {
  const player = sim.store(Player);
  const position = sim.store(Position);
  const occupied = new Set<number>();
  for (const eid of query(sim.world, [player, position])) {
    const tile = tileAt(grid, position.x[eid] as number, position.y[eid] as number);
    if (tile) occupied.add(tileKey(grid, tile));
  }
  return occupied;
}

function tileKey(grid: TileGrid, { column, row }: TileCoordinate): number {
  return row * grid.columns + column;
}
