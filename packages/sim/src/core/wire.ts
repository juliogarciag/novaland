import type { WorldState } from './worldState';

/**
 * The messages between a browser and the world server, as ADR 0004 fixes
 * them. The sim does no networking; the names and payload types live here so
 * the server room and the client online mode are built against one
 * definition. Payloads are plain JSON. A delta or full state payload is a
 * `WorldStateUpdate` (worldState.ts).
 */
export const WIRE = {
  /** Server → client, once, when the join is accepted. Payload: WelcomeMessage. */
  welcome: 'welcome',
  /** Server → client at the send rate. Payload: WorldStateDelta. */
  delta: 'world/delta',
  /** Server → client on request or whenever it cannot continue a client's sequence. Payload: WorldState. */
  state: 'world/state',
  /** Client → server: send me a full world state. Payload: none. */
  resync: 'world/resync',
  /** Client → server: the player's move intent. Payload: MoveMessage. The server stamps the slot. */
  move: 'player/move',
} as const;

export interface WelcomeMessage {
  /** The client's seat: the `slot` of its player entity. */
  readonly seat: number;
  /** Name of the level the server runs; the client builds its replica from the matching LevelData. */
  readonly level: string;
  /** Capacity of the server's sim; the replica is created with the same one. */
  readonly capacity: number;
  readonly state: WorldState;
}

/** A `player/move` as the client sends it: no slot. The server adds the client's seat before it reaches the sim. */
export interface MoveMessage {
  readonly x: number;
  readonly y: number;
}
