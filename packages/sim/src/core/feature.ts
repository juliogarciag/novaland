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
  /**
   * Gives entity `eid` the physics body this feature attaches when it spawns
   * one, read from the entity's components. Called on a prediction after the
   * entity's components were copied from the authoritative state instead of
   * being spawned here (`adoptEntity`, ADR 0011). The components came over
   * the network: ignore an entity that is not yours or whose values cannot
   * make a body, never throw.
   */
  attachBody?(sim: Sim, eid: number): void;
}
