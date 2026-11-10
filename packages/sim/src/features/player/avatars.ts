import { query } from 'bitecs';
import type { Sim } from '../../core/sim';
import { DefRef } from '../../core/transform';
import { Player } from './components';
import { avatarDefIds } from './defs';

/**
 * The avatar def id a joining player gets: one of the avatars nobody present
 * wears, chosen with the sim's rng, so the same seed and joins always dress
 * players the same way. Once every avatar is worn the choice falls back to
 * the whole set, so a sixth or ninth player still gets one.
 */
export function pickAvatarDefId(sim: Sim): number {
  const worn = wornAvatarDefIds(sim);
  const unworn = avatarDefIds.filter((defId) => !worn.has(defId));
  const choices = unworn.length > 0 ? unworn : avatarDefIds;
  return choices[sim.rng.nextInt(choices.length)] as number;
}

/** The avatar def ids of every player in the sim right now. */
function wornAvatarDefIds(sim: Sim): ReadonlySet<number> {
  const player = sim.store(Player);
  const defRef = sim.store(DefRef);
  const worn = new Set<number>();
  for (const eid of query(sim.world, [player, defRef])) worn.add(defRef.id[eid] as number);
  return worn;
}
