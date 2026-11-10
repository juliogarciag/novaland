/**
 * A player joins the world in the given slot (0-based seat number). Ignored if
 * the slot is taken or the sim is full. It carries no avatar and no position:
 * the sim picks both, so a client can neither choose its look nor its spawn.
 */
export interface JoinCommand {
  readonly type: 'player/join';
  readonly slot: number;
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

export type PlayerCommand = JoinCommand | LeaveCommand | MoveCommand;
