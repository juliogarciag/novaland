import type { MoveCommand } from '../features/player/commands';
import type { WorldState } from './worldState';

/**
 * The messages between a browser and the world server, as ADR 0004 fixes
 * them. The sim does no networking; the names, payload types and protocol
 * constants live here so the server room and the client online mode are
 * built against one definition. Payloads are plain JSON. A delta or full
 * state payload is a `WorldStateUpdate` (worldState.ts).
 */
export const WIRE = {
  /** Server → client, once, when the join is accepted. Payload: WelcomeMessage. */
  welcome: 'world/welcome',
  /** Server → client at the send rate. Payload: WorldStateDelta. */
  delta: 'world/delta',
  /** Server → client on request or whenever it cannot continue a client's sequence. Payload: WorldState. */
  state: 'world/state',
  /** Client → server: send me a full world state. Payload: none. */
  resync: 'world/resync',
  /** Client → server: the player's move intent. Payload: MoveMessage. The server stamps the slot. */
  move: 'player/move',
} as const;

/** Reasons a server refuses a join. */
export const JOIN_REFUSAL = {
  /** Every seat is taken. */
  worldFull: 'world-full',
} as const;

/** World-state deltas per second a server sends its players. The server may be configured with another rate. */
export const DEFAULT_SEND_RATE = 20;

export interface WelcomeMessage {
  /** The client's seat: the `slot` of its player entity and of the commands the server stamps for it. */
  readonly slot: number;
  /** Name of the level the server runs; the client resolves it with `findLevel` and builds its replica from it. */
  readonly level: string;
  /** Capacity of the server's sim; the replica is created with the same one (createReplica refuses one outside 1..MAX_CAPACITY). */
  readonly capacity: number;
  /** Taken after the tick that processed the client's `player/join`, so `findPlayerEntity(replica, slot)` finds the client's own entity in it. */
  readonly state: WorldState;
}

/** A `player/move` as the client sends it: no type (the message name is the type) and no slot (the server adds the client's). */
export type MoveMessage = Omit<MoveCommand, 'type' | 'slot'>;
