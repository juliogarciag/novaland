import { addComponent } from 'bitecs';
import type { Feature } from '../../core/feature';
import { attachStaticBox } from '../../core/physics';
import type { Sim } from '../../core/sim';
import { DefRef, Extents } from '../../core/transform';
import { WallDefId } from './defs';

/** Static walls from level data. Nothing moves them; they only exist to be collided with. */
export const wallsFeature: Feature = {
  name: 'walls',
  init(sim) {
    for (const wall of sim.level.walls) spawnWall(sim, wall.x, wall.y, wall.w, wall.h, wall.defId ?? WallDefId.Wall);
  },
};

function spawnWall(sim: Sim, x: number, y: number, w: number, h: number, defId: number): number {
  const eid = sim.createEntity();
  const defRef = sim.store(DefRef);
  const extents = sim.store(Extents);
  addComponent(sim.world, eid, defRef);
  addComponent(sim.world, eid, extents);
  defRef.id[eid] = defId;
  extents.hw[eid] = w / 2;
  extents.hh[eid] = h / 2;
  attachStaticBox(sim, eid, x, y, w / 2, h / 2);
  return eid;
}
