import type { Command, SimHandle } from '@novaland/sim';
import type { ViewFrame } from '../render/viewFrame';

/** How many of the world's seats are taken. Only an online world knows. */
export interface Occupancy {
  readonly online: number;
  readonly seats: number;
}

/**
 * What the scenes play: a sim to read and a place to hand the player's
 * commands to. Solo (`LocalWorld`) the sim is a live one that this client
 * steps; online (`OnlineWorld`) it is a replica that the server fills and
 * the commands go over the wire. The scenes, the renderer, the camera, the
 * HUD and the debug hooks only ever see this interface, so neither mode
 * leaks into them (ADR 0005).
 */
export interface PlayableWorld {
  /** What everything reads. Online it is the replica. */
  readonly sim: SimHandle;
  /** Seat of the player at this keyboard: the slot whose entity the camera follows. */
  readonly localSlot: number;
  /** Seats taken out of seats available; undefined solo, where there is no count to show. */
  readonly occupancy: Occupancy | undefined;
  /**
   * Hands over the commands of this frame and the real time that passed, and
   * returns what to draw. Solo: the commands wait for the next whole tick and
   * the sim steps. Online: the commands go to the server and the drawn frame
   * advances along the buffered server states.
   */
  advance(commands: readonly Command[], deltaSeconds: number): ViewFrame;
}
