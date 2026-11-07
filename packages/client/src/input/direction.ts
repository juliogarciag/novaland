/** Pure mapping from pressed directions to a move vector. Kept free of Phaser so it is unit-testable. */
export interface DirectionKeys {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

export interface Direction {
  readonly x: number;
  readonly y: number;
}

/**
 * Opposite keys cancel. Diagonals are sent as (±1, ±1): the sim normalises
 * movement, the client only reports what is pressed.
 */
export function directionFromKeys(keys: DirectionKeys): Direction {
  return {
    x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
    y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0),
  };
}

export function sameDirection(a: Direction, b: Direction): boolean {
  return a.x === b.x && a.y === b.y;
}
