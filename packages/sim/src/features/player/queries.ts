import { query } from 'bitecs';
import type { Sim } from '../../core/sim';
import { Player } from './components';

/** Entity id of the player in `slot`, or undefined if nobody is in it. */
export function findPlayerEntity(sim: Sim, slot: number): number | undefined {
  const player = sim.store(Player);
  for (const eid of query(sim.world, [player])) {
    if (player.slot[eid] === slot) return eid;
  }
  return undefined;
}
