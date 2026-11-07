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

/** Opposite keys cancel; diagonals are normalised so speed is the same in every direction. */
export function directionFromKeys(keys: DirectionKeys): Direction {
  const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (x !== 0 && y !== 0) {
    const inv = 1 / Math.SQRT2;
    return { x: x * inv, y: y * inv };
  }
  return { x, y };
}

export function sameDirection(a: Direction, b: Direction): boolean {
  return a.x === b.x && a.y === b.y;
}
