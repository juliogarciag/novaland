import type { Command } from './commands';
import type { Sim } from './sim';

/**
 * A feature is a self-contained slice of game logic living in
 * features/<name>/. The sim calls the hooks below in this order every tick:
 *
 *   handleCommand (per command) -> update -> [physics step] -> postStep
 *
 * Features must only touch sim state through components, defs and the sim
 * API. Never keep per-entity state in closures or module variables.
 */
export interface Feature {
  readonly name: string;
  /** Called once when the sim is created, after the physics world exists. */
  init?(sim: Sim): void;
  /** Called for every command of the tick. Ignore commands you do not own. */
  handleCommand?(sim: Sim, command: Command): void;
  /** Runs before the physics step. Set velocities, apply forces, spawn things. */
  update?(sim: Sim): void;
  /** Runs after positions have been synced back from physics. */
  postStep?(sim: Sim): void;
}
