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
 * leaks into them (ADR 0006).
 */
export interface PlayableWorld {
  /** What everything reads. Online it is the replica. */
  readonly sim: SimHandle;
  /** Seat of the player at this keyboard: the slot whose entity the camera follows. */
  readonly localSlot: number;
  /** Seats taken out of seats available; undefined solo, where there is no count to show. */
  readonly occupancy: Occupancy | undefined;
  /**
   * The frame to draw after this frame's commands and `deltaSeconds` of real
   * time. Solo: the commands wait for the next whole tick, the sim steps and
   * the frame is read from it. Online: the commands go to the server and the
   * frame is a point along the buffered server states.
   */
  nextFrame(commands: readonly Command[], deltaSeconds: number): ViewFrame;
}
