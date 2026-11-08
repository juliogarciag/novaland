import { defineComponent, f64, u32 } from '../../core/components';

/** Marks a player-controlled entity and which seat controls it. */
export const Player = defineComponent('Player', (capacity) => ({
  slot: u32(capacity),
}));

/** Last requested movement direction, unit length or shorter. */
export const MoveIntent = defineComponent('MoveIntent', (capacity) => ({
  x: f64(capacity),
  y: f64(capacity),
}));
