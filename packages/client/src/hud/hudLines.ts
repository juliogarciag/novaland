import { findPlayerEntity, getDef, getRenderables, isAvatarDefId } from '@novaland/sim';
import type { PlayableWorld } from '../worlds/PlayableWorld';

/** What the HUD shows that the world does not know: facts about this client's own drawing. */
export interface HudViewFacts {
  /** Frames drawn per second; undefined until a first second has been counted. */
  readonly framesPerSecond: number | undefined;
}

/**
 * The HUD text: the frame rate, and online the round trip to the server and
 * the seats taken; who you are and how many players; the dev J key where the
 * world offers it. A value not measured yet shows as `--`; solo there is no
 * server, so no latency at all.
 */
export function hudLines(world: PlayableWorld, { framesPerSecond }: HudViewFacts): string[] {
  const occupancy = world.occupancy;
  const status = [`fps ${measured(framesPerSecond)}`];
  if (occupancy) status.push(`latency ${measured(world.latencyMs)} ms`, `${occupancy.online}/${occupancy.seats} online`);
  const players = getRenderables(world.sim).filter((renderable) => isAvatarDefId(renderable.defId));
  const localEid = findPlayerEntity(world.sim, world.localSlot);
  const local = players.find((player) => player.eid === localEid);
  const lines = [status.join('   '), `you: ${local ? getDef(local.defId).name : 'joining...'}   players: ${players.length}`];
  if (import.meta.env.DEV && world.joinAnotherSeat) lines.push('J: seat another player (dev)');
  return lines;
}

/** A measurement as the HUD prints it: a whole number, or `--` while there is none. */
function measured(value: number | undefined): string {
  return value === undefined ? '--' : String(Math.round(value));
}
