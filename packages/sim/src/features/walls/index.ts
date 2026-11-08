import { addComponent } from 'bitecs';
import type { WallData } from '../../content/levels/types';
import type { Feature } from '../../core/feature';
import { attachStaticBox } from '../../core/physics';
import type { Sim } from '../../core/sim';
import { DefRef, Extents } from '../../core/transform';
import { WallDefId } from './defs';

/** Static walls from level data. Nothing moves them; they only exist to be collided with. */
export const wallsFeature: Feature = {
  name: 'walls',
  init(sim) {
    for (const wall of sim.level.walls) spawnWall(sim, wall);
  },
};

function spawnWall(sim: Sim, wall: WallData): number {
  const halfWidth = wall.width / 2;
  const halfHeight = wall.height / 2;
  const eid = sim.createEntity();
  const defRef = sim.store(DefRef);
  const extents = sim.store(Extents);
  addComponent(sim.world, eid, defRef);
  addComponent(sim.world, eid, extents);
  defRef.id[eid] = wall.defId ?? WallDefId.Wall;
  extents.halfWidth[eid] = halfWidth;
  extents.halfHeight[eid] = halfHeight;
  attachStaticBox(sim, eid, { x: wall.x, y: wall.y, halfWidth, halfHeight });
  return eid;
}
