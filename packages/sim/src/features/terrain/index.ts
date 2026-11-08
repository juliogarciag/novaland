import { addComponent } from 'bitecs';
import { readTileGrid, tileCentre } from '../../content/levels/grid';
import type { TileGrid } from '../../content/levels/types';
import type { Feature } from '../../core/feature';
import { attachStaticBox } from '../../core/physics';
import type { Sim } from '../../core/sim';
import { Extents } from '../../core/transform';
import { TerrainCollider } from './components';
import { solidRectangles, type TileRectangle } from './rectangles';

/**
 * The ground and what stands on it. The level's solid tiles (trees, rocks)
 * become static colliders, merged into rectangles so a forest border is a
 * handful of boxes rather than hundreds. Walkable tiles have no entity at
 * all: the client draws every tile from the same level data.
 */
export const terrainFeature: Feature = {
  name: 'terrain',
  init(sim) {
    const grid = readTileGrid(sim.level);
    for (const rectangle of solidRectangles(grid)) spawnCollider(sim, grid, rectangle);
  },
};

function spawnCollider(sim: Sim, grid: TileGrid, rectangle: TileRectangle): number {
  const halfWidth = (rectangle.width * grid.tileSize) / 2;
  const halfHeight = (rectangle.height * grid.tileSize) / 2;
  const topLeft = tileCentre(grid, rectangle);
  const x = topLeft.x - grid.tileSize / 2 + halfWidth;
  const y = topLeft.y - grid.tileSize / 2 + halfHeight;
  const eid = sim.createEntity();
  const collider = sim.store(TerrainCollider);
  const extents = sim.store(Extents);
  addComponent(sim.world, eid, collider);
  addComponent(sim.world, eid, extents);
  collider.column[eid] = rectangle.column;
  collider.row[eid] = rectangle.row;
  collider.width[eid] = rectangle.width;
  collider.height[eid] = rectangle.height;
  extents.halfWidth[eid] = halfWidth;
  extents.halfHeight[eid] = halfHeight;
  attachStaticBox(sim, eid, { x, y, halfWidth, halfHeight });
  return eid;
}
