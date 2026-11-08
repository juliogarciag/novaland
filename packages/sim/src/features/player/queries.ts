import { query } from 'bitecs';
import { asSim, type SimHandle } from '../../core/sim';
import { Player } from './components';

/** Entity id of the player in `slot`, or undefined if nobody is in it. */
export function findPlayerEntity(handle: SimHandle, slot: number): number | undefined {
  const sim = asSim(handle);
  const player = sim.store(Player);
  for (const eid of query(sim.world, [player])) {
    if (player.slot[eid] === slot) return eid;
  }
  return undefined;
}
