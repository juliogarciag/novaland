import type { PlayerCommand } from '../features/player/commands';

/**
 * Commands are the only way input reaches the sim. They must be plain,
 * serializable objects (JSON-safe) so they can travel over the network and be
 * recorded for replays.
 *
 * Each feature declares its own command types in features/<feature>/commands.ts
 * and handles them in its Feature.handleCommand. The `type` literal is
 * namespaced as '<feature>/<verb>' so two features can never claim the same
 * one. Add the feature's union here.
 */
export type Command = PlayerCommand;

/** True when `value` has the minimal shape of a command. Anything else is dropped by Sim.step. */
export function isCommandShaped(value: unknown): value is Command {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
