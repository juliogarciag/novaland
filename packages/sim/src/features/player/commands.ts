import type { Character } from './character';

/**
 * A player joins the world in the given slot (0-based seat number) as the
 * character they made: a look and a name. Ignored if the slot is taken, the
 * sim is full or the character is not a legal one (`readCharacter`).
 */
export interface JoinCommand {
  readonly type: 'player/join';
  readonly slot: number;
  readonly character: Character;
  /**
   * Where a returning player was when they left, in metres. Only whoever
   * steps the sim sets it, from positions it saved itself: nothing a client
   * sends ever becomes this field, so a client cannot choose where it
   * appears. The player lands there if that tile is still free, else on the
   * nearest free tile. Without it, or with one that is malformed or has no
   * free tile near it, the player spawns as a new one does.
   */
  readonly returnTo?: { readonly x: number; readonly y: number };
}

/** A player leaves; their entity is removed. */
export interface LeaveCommand {
  readonly type: 'player/leave';
  readonly slot: number;
}

/**
 * Desired movement direction. Components are clamped to [-1, 1] and the
 * vector is normalised if longer than 1. Send it when the direction changes,
 * not every tick: the sim keeps moving until it gets a new one.
 */
export interface MoveCommand {
  readonly type: 'player/move';
  readonly slot: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The player in the given slot becomes another character: a new look, a new
 * name, the same entity where it stands. Ignored if nobody sits in the slot
 * or the character is not a legal one (`readCharacter`), exactly as a join's.
 */
export interface ChangeCharacterCommand {
  readonly type: 'player/change-character';
  readonly slot: number;
  readonly character: Character;
}

export type PlayerCommand = JoinCommand | LeaveCommand | MoveCommand | ChangeCharacterCommand;
