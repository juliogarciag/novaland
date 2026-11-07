/** A player joins the world in the given slot (0-based seat number). Ignored if the slot is taken. */
export interface JoinCommand {
  readonly type: 'join';
  readonly slot: number;
}

/** A player leaves; their entity is removed. */
export interface LeaveCommand {
  readonly type: 'leave';
  readonly slot: number;
}

/**
 * Desired movement direction. Components in [-1, 1]; longer vectors are
 * normalised by the sim. Send it when the direction changes, not every tick:
 * the sim keeps moving until it gets a new one.
 */
export interface MoveCommand {
  readonly type: 'move';
  readonly slot: number;
  readonly x: number;
  readonly y: number;
}

export type PlayerCommand = JoinCommand | LeaveCommand | MoveCommand;
