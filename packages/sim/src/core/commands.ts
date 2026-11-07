import type { PlayerCommand } from '../features/player/commands';

/**
 * Commands are the only way input reaches the sim. They must be plain,
 * serializable objects (JSON-safe) so they can travel over the network and be
 * recorded for replays.
 *
 * Each feature declares its own command types in features/<feature>/commands.ts
 * and handles them in its Feature.handleCommand. Add the feature's union here.
 */
export type Command = PlayerCommand;
