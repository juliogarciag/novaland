import type { PlayerHeading, SpriteDirection } from '@novaland/sim';

/** Which sheet direction to show and whether the walk cycle plays. */
export interface SpritePose {
  readonly direction: SpriteDirection;
  readonly walking: boolean;
}

/** What a sprite shows before the sim says anything about it. */
export const IDLE_DOWN: SpritePose = { direction: 'down', walking: false };

/**
 * A moving player faces its move intent and walks; a stopped one stands
 * looking where it last moved. Pure, so it is unit-testable without Phaser.
 */
export function poseFromHeading(heading: PlayerHeading): SpritePose {
  const walking = heading.moveIntent.x !== 0 || heading.moveIntent.y !== 0;
  const vector = walking ? heading.moveIntent : heading.facing;
  return { direction: directionFromVector(vector.x, vector.y), walking };
}

/** The sheet direction closest to a vector in sim space (y points down). Diagonals go to the horizontal frames; a zero vector faces down. */
export function directionFromVector(x: number, y: number): SpriteDirection {
  if (x === 0 && y === 0) return 'down';
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}
