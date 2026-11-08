import type { Command, MoveCommand } from '@novaland/sim';
import type Phaser from 'phaser';
import { directionFromKeys, sameDirection, type Direction } from './direction';

/**
 * Turns keyboard state into sim commands. Emits a `player/move` only when
 * the direction changes, which is all the sim needs (it keeps the last intent).
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
  let lastDirection: Direction = { x: 0, y: 0 };
  return {
    drain() {
      const direction = directionFromKeys({
        up: keys.W.isDown || keys.UP.isDown,
        down: keys.S.isDown || keys.DOWN.isDown,
        left: keys.A.isDown || keys.LEFT.isDown,
        right: keys.D.isDown || keys.RIGHT.isDown,
      });
      if (sameDirection(direction, lastDirection)) return [];
      lastDirection = direction;
      const move: MoveCommand = { type: 'player/move', slot, x: direction.x, y: direction.y };
      return [move];
    },
  };
}
