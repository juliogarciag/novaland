import { hasComponent, query } from 'bitecs';
import { getDef } from '../content/defs';
import { DEFAULT_RADIUS } from '../content/tuning';
import { asSim, type SimHandle } from './sim';
import { DefRef, Extents, Position } from './transform';

/**
 * What a view needs to draw an entity. This is the read side of the
 * sim/client boundary: the client never touches components directly.
 */
export interface Renderable {
  readonly eid: number;
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  /** Half extents in metres. For circles both equal the radius. */
  readonly hw: number;
  readonly hh: number;
}

export function getRenderables(handle: SimHandle): Renderable[] {
  const sim = asSim(handle);
  const position = sim.store(Position);
  const defRef = sim.store(DefRef);
  const extents = sim.store(Extents);
  const out: Renderable[] = [];
  for (const eid of query(sim.world, [position, defRef])) {
    const defId = defRef.id[eid] as number;
    let hw: number;
    let hh: number;
    if (hasComponent(sim.world, eid, extents)) {
      hw = extents.hw[eid] as number;
      hh = extents.hh[eid] as number;
    } else {
      const radius = getDef(defId).radius ?? DEFAULT_RADIUS;
      hw = radius;
      hh = radius;
    }
    out.push({ eid, defId, x: position.x[eid] as number, y: position.y[eid] as number, hw, hh });
  }
  return out;
}
