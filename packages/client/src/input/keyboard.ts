import type { Command, MoveCommand } from '@novaland/sim';
import type Phaser from 'phaser';
import { directionFromKeys, sameDirection, type Direction } from './direction';

/**
 * Turns keyboard state into sim commands. Emits a `move` only when the
 * direction changes, which is all the sim needs (it keeps the last intent).
 */
export interface KeyboardInput {
  /** Commands produced since the last call. Call once per frame. */
  drain(): Command[];
}

type KeyMap = Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;

export function createKeyboardInput(scene: Phaser.Scene, slot: number): KeyboardInput {
  const keyboard = scene.input.keyboard;
  if (!keyboard) {
    return { drain: () => [] };
  }
  const keys = keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as KeyMap;
  let last: Direction = { x: 0, y: 0 };
  return {
    drain() {
      const next = directionFromKeys({
        up: keys.W.isDown || keys.UP.isDown,
        down: keys.S.isDown || keys.DOWN.isDown,
        left: keys.A.isDown || keys.LEFT.isDown,
        right: keys.D.isDown || keys.RIGHT.isDown,
      });
      if (sameDirection(next, last)) return [];
      last = next;
      const move: MoveCommand = { type: 'move', slot, x: next.x, y: next.y };
      return [move];
    },
  };
}
