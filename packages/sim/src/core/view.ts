import { hasComponent, query } from 'bitecs';
import { findDef } from '../content/defs';
import { DEFAULT_RADIUS } from '../content/tuning';
import { asEntityWorld } from './entityWorld';
import type { SimHandle } from './sim';
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
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/**
 * Everything to draw, in a sim or a replica, in entity id order. The order
 * is part of the contract: bitECS iterates in the order things were added,
 * which a replica rebuilt from a full state does not share with the sim it
 * copies. An entity whose DefRef points at no def is left out: a live sim
 * never makes one, but a replica is fed from the network and must not crash
 * the view on one.
 */
export function getRenderables(handle: SimHandle): Renderable[] {
  const sim = asEntityWorld(handle);
  const position = sim.store(Position);
  const defRef = sim.store(DefRef);
  const extents = sim.store(Extents);
  const renderables: Renderable[] = [];
  for (const eid of [...query(sim.world, [position, defRef])].sort((a, b) => a - b)) {
    const defId = defRef.id[eid] as number;
    const def = findDef(defId);
    if (!def) continue;
    let halfWidth: number;
    let halfHeight: number;
    if (hasComponent(sim.world, eid, extents)) {
      halfWidth = extents.halfWidth[eid] as number;
      halfHeight = extents.halfHeight[eid] as number;
    } else {
      const radius = def.radius ?? DEFAULT_RADIUS;
      halfWidth = radius;
      halfHeight = radius;
    }
    renderables.push({ eid, defId, x: position.x[eid] as number, y: position.y[eid] as number, halfWidth, halfHeight });
  }
  return renderables;
}
