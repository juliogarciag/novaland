import { findPlayerEntity, getCharacter, getRenderables, isPlayerDefId } from '@novaland/sim';
import type { PlayableWorld } from '../worlds/PlayableWorld';

/** What the HUD shows that the world does not know: facts about this client's own drawing. */
export interface HudViewFacts {
  /** Frames drawn per second; undefined until a first second has been counted. */
  readonly framesPerSecond: number | undefined;
  /** How much of the map the world camera shows, in tiles; undefined until the world is drawn. */
  readonly tilesInView?: { readonly across: number; readonly down: number } | undefined;
}

/**
 * The HUD text: the frame rate, and online the round trip to the server and
 * the seats taken; who you are and how many players; the dev J key where the
 * world offers it; in a dev build, how many tiles of the map are on screen,
 * which is what the mouse wheel changes there. A value not measured yet shows as `--`; solo there is no
 * server, so no latency at all. Numbers keep a fixed width, so the backdrop
 * does not change size every time one gains or loses a digit.
 */
export function hudLines(world: PlayableWorld, { framesPerSecond, tilesInView }: HudViewFacts): string[] {
  const occupancy = world.occupancy;
  const firstLineParts = [`fps ${wholeNumberOrDashes(framesPerSecond)}`];
  if (occupancy) firstLineParts.push(`latency ${wholeNumberOrDashes(world.latencyMs)} ms`, `${occupancy.online}/${occupancy.seats} online`);
  const players = getRenderables(world.sim).filter((renderable) => isPlayerDefId(renderable.defId));
  const localEid = findPlayerEntity(world.sim, world.localSlot);
  const localName = localEid === undefined ? undefined : getCharacter(world.sim, localEid)?.name;
  const lines = [firstLineParts.join('   '), `you: ${localName ?? 'joining...'}   players: ${players.length}`];
  if (import.meta.env.DEV && world.joinAnotherSeat) lines.push('J: seat another player (dev)');
  if (import.meta.env.DEV && tilesInView) lines.push(`view: ${wholeNumberOrDashes(tilesInView.across)} x ${wholeNumberOrDashes(tilesInView.down)} tiles   wheel: zoom (dev)`);
  return lines;
}

/** Characters a measurement takes: enough for a three-digit number. A longer one still prints in full. */
const NUMBER_WIDTH = 3;

/** A measurement as the HUD prints it: a whole number, or `--` while there is none, right-aligned in `NUMBER_WIDTH` characters. */
function wholeNumberOrDashes(value: number | undefined): string {
  return (value === undefined ? '--' : String(Math.round(value))).padStart(NUMBER_WIDTH);
}
