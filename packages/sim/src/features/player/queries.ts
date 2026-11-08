import { hasComponent, query } from 'bitecs';
import { asSim, type SimHandle } from '../../core/sim';
import { Facing, MoveIntent, Player } from './components';

/** Entity id of the player in `slot`, or undefined if nobody is in it. */
export function findPlayerEntity(handle: SimHandle, slot: number): number | undefined {
  const sim = asSim(handle);
  const player = sim.store(Player);
  for (const eid of query(sim.world, [player])) {
    if (player.slot[eid] === slot) return eid;
  }
  return undefined;
}

/** Which way an entity is going and looking. Both are vectors in sim space (y points down). */
export interface Heading {
  /** Current move intent, zero when the player is standing still. */
  readonly moveIntent: { readonly x: number; readonly y: number };
  /** Unit direction of the last non-zero move intent. */
  readonly facing: { readonly x: number; readonly y: number };
}

/**
 * Heading of entity `eid`, or undefined if it is not something that moves and
 * faces (today only players). Views pick a walk or idle frame from it.
 */
export function getHeading(handle: SimHandle, eid: number): Heading | undefined {
  const sim = asSim(handle);
  const intent = sim.store(MoveIntent);
  const facing = sim.store(Facing);
  if (!Number.isInteger(eid) || eid < 1 || eid > sim.capacity) return undefined;
  if (!hasComponent(sim.world, eid, intent) || !hasComponent(sim.world, eid, facing)) return undefined;
  return {
    moveIntent: { x: intent.x[eid] as number, y: intent.y[eid] as number },
    facing: { x: facing.x[eid] as number, y: facing.y[eid] as number },
  };
}
