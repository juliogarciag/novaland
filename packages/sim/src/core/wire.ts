import type { Character } from '../features/player/character';
import type { ChangeCharacterCommand, MoveCommand } from '../features/player/commands';
import type { WorldState } from './worldState';

/**
 * The version of this contract. A client sends it when it joins (`JoinOptions`)
 * and a server answers with its own in the welcome; each refuses the other
 * when the two differ, so a page loaded before a deploy is told to reload
 * instead of talking past the server. Count it up with every change to the
 * messages below. 2: `player/move` carries a sequence and the server
 * acknowledges it with `player/move-applied` (ADR 0012). 3: the welcome
 * names the map by its checksum instead of a level name, and world states no
 * longer hold terrain (ADR 0013). 4: a join carries the player's character
 * and is refused without a legal one, and `player/change-character` changes
 * it afterwards (ADR 0015). 5: a character's look carries a body type and a
 * hairstyle (ADR 0017), so a page from before would send looks the server
 * refuses. Not counted up for `JoinOptions.playerToken`
 * (ADR 0014): a join without it and a server that ignores it both still work,
 * so no page has to reload for it.
 */
export const WIRE_PROTOCOL = 5;

/**
 * The messages between a browser and the world server, as ADR 0004 and 0012
 * fix them. The sim does no networking; the names, payload types and
 * protocol constants live here so the server room and the client online mode
 * are built against one definition. Payloads are plain JSON. A delta or full
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
  /** Client → server: the player becomes another character where it stands. Payload: ChangeCharacterMessage. The server stamps the slot. */
  changeCharacter: 'player/change-character',
  /** Server → client, just before the first world update that includes a move of this client. Payload: MoveAppliedMessage. */
  moveApplied: 'player/move-applied',
} as const;

/** Reasons a server refuses a join. */
export const JOIN_REFUSAL = {
  /** Every seat is taken. */
  worldFull: 'world-full',
  /** The client was built against another `WIRE_PROTOCOL`, or sent none. */
  protocolMismatch: 'protocol-mismatch',
  /** The join's options hold no legal character (`readCharacter`). */
  invalidCharacter: 'invalid-character',
} as const;

/** What a client passes when it joins the room. The server reads each field on its own and trusts none. */
export interface JoinOptions {
  /** The `WIRE_PROTOCOL` the client was built against. */
  readonly protocol: number;
  /** The character the player made: the server refuses the join with `JOIN_REFUSAL.invalidCharacter` unless `readCharacter` accepts it. */
  readonly character: Character;
  /**
   * The secret that says which player this is, so the server can put them
   * back where they left (ADR 0014). The browser makes it up once and keeps
   * it; there are no accounts. It is a credential: it travels only in the
   * join, client to server, and is never sent to anyone else. A join without
   * one, or with one that is not `isPlayerToken`, is a new player.
   */
  readonly playerToken?: string;
}

/** Characters of a player token: 32 random bytes as base64url, without padding. */
const PLAYER_TOKEN_LENGTH = 43;

const PLAYER_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

/** True when `value` has the shape of a player token: a string of exactly `PLAYER_TOKEN_LENGTH` base64url characters. The shape says nothing about whether any server has seen it. */
export function isPlayerToken(value: unknown): value is string {
  return typeof value === 'string' && value.length === PLAYER_TOKEN_LENGTH && PLAYER_TOKEN_PATTERN.test(value);
}

/** World-state deltas per second a server sends its players. The server may be configured with another rate. */
export const DEFAULT_SEND_RATE = 20;

export interface WelcomeMessage {
  /** The `WIRE_PROTOCOL` the server speaks. A client built against another one cannot play here. */
  readonly protocol: number;
  /** The client's seat: the `slot` of its player entity and of the commands the server stamps for it. */
  readonly slot: number;
  /**
   * Checksum of the map the server runs (`MapTiles.checksum`). Terrain does not travel: both sides build it from
   * the map they ship, so a client whose own map has another checksum would draw and predict against the wrong
   * ground and cannot play here.
   */
  readonly map: string;
  /** Capacity of the server's sim; the replica is created with the same one (createReplica refuses one outside 1..MAX_CAPACITY). */
  readonly capacity: number;
  /** Taken after the tick that processed the client's `player/join`, so `findPlayerEntity(replica, slot)` finds the client's own entity in it. */
  readonly state: WorldState;
}

/**
 * A `player/move` as the client sends it: no type (the message name is the
 * type) and no slot (the server adds the client's), plus a `sequence` the
 * client counts up from 1 so the server can say which moves a world state
 * already includes. The sequence stays in the room: the sim's command has none.
 */
export type MoveMessage = Omit<MoveCommand, 'type' | 'slot'> & { readonly sequence: number };

/**
 * A `player/change-character` as the client sends it: no type (the message
 * name is the type) and no slot (the server adds the client's). There is no
 * answer: the change arrives with the next world update, like anyone's.
 */
export type ChangeCharacterMessage = Omit<ChangeCharacterCommand, 'type' | 'slot'>;

/**
 * The sim applied this client's move `sequence`, and every move it sent
 * before it, in the step that made the sim's tick `tick`. The world update
 * that follows this message is the first one that includes it.
 */
export interface MoveAppliedMessage {
  readonly sequence: number;
  readonly tick: number;
}
