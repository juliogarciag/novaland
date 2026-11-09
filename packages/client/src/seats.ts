import { findPlayerEntity, MAX_PLAYER_SLOTS, type Command, type SimHandle } from '@novaland/sim';

/** Seat of the local player. Multiplayer will assign this from the server. */
export const LOCAL_SLOT = 0;

/**
 * The lowest seat nobody sits in and no queued join is about to take, or
 * undefined when every seat is spoken for. Joins wait in the command buffer
 * until the next tick, so two joins queued in one frame must not pick the
 * same seat.
 *
 * Dev-only convenience for seating extra players from one browser: a client
 * choosing seats is a stop-gap until the server assigns them. The sim still
 * rejects a join for a taken seat, so nothing depends on this being right.
 */
export function firstEmptySeat(sim: SimHandle, pendingCommands: readonly Command[]): number | undefined {
  const pendingJoins = new Set(pendingCommands.flatMap((command) => (command.type === 'player/join' ? [command.slot] : [])));
  for (let slot = 0; slot < MAX_PLAYER_SLOTS; slot += 1) {
    if (!pendingJoins.has(slot) && findPlayerEntity(sim, slot) === undefined) return slot;
  }
  return undefined;
}
