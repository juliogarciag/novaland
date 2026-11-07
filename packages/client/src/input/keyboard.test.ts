import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';
import { createKeyboardInput } from './keyboard';

type KeyName = 'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
const KEY_NAMES: readonly KeyName[] = ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT'];

/**
 * The smallest stand-in for a Phaser scene that `createKeyboardInput` touches:
 * `scene.input.keyboard.addKeys(...)` returning objects with an `isDown` flag.
 * Phaser itself is never loaded (the module imports it as a type only).
 */
function fakeScene() {
  const keys = Object.fromEntries(KEY_NAMES.map((name) => [name, { isDown: false }])) as Record<KeyName, { isDown: boolean }>;
  const requested: string[] = [];
  const scene = {
    input: {
      keyboard: {
        addKeys(spec: string) {
          requested.push(spec);
          return keys;
        },
      },
    },
  } as unknown as Phaser.Scene;
  const press = (...names: KeyName[]) => names.forEach((name) => (keys[name].isDown = true));
  const release = (...names: KeyName[]) => names.forEach((name) => (keys[name].isDown = false));
  return { scene, press, release, requested };
}

describe('createKeyboardInput', () => {
  it('registers WASD and the arrow keys with the scene', () => {
    const { scene, requested } = fakeScene();
    createKeyboardInput(scene, 0);
    expect(requested).toEqual(['W,A,S,D,UP,DOWN,LEFT,RIGHT']);
  });

  it('emits nothing while no key is held', () => {
    const { scene } = fakeScene();
    const input = createKeyboardInput(scene, 0);
    expect(input.drain()).toEqual([]);
    expect(input.drain()).toEqual([]);
  });

  it('emits one player/move for the given slot when a key goes down', () => {
    const { scene, press } = fakeScene();
    const input = createKeyboardInput(scene, 3);
    press('D');
    expect(input.drain()).toEqual([{ type: 'player/move', slot: 3, x: 1, y: 0 }]);
  });

  it('emits only on change: holding a key produces no repeats', () => {
    const { scene, press } = fakeScene();
    const input = createKeyboardInput(scene, 0);
    press('W');
    expect(input.drain()).toHaveLength(1);
    expect(input.drain()).toEqual([]);
    expect(input.drain()).toEqual([]);
  });

  it('emits a stop (0, 0) when the last key is released', () => {
    const { scene, press, release } = fakeScene();
    const input = createKeyboardInput(scene, 0);
    press('A');
    input.drain();
    release('A');
    expect(input.drain()).toEqual([{ type: 'player/move', slot: 0, x: 0, y: 0 }]);
  });

  it('treats arrows and WASD as the same direction, so switching between them is silent', () => {
    const { scene, press, release } = fakeScene();
    const input = createKeyboardInput(scene, 0);
    press('RIGHT');
    expect(input.drain()).toEqual([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    press('D');
    release('RIGHT');
    expect(input.drain()).toEqual([]);
  });

  it('reports diagonals and opposite-key cancellation as the direction mapping does', () => {
    const { scene, press, release } = fakeScene();
    const input = createKeyboardInput(scene, 0);
    press('S', 'D');
    expect(input.drain()).toEqual([{ type: 'player/move', slot: 0, x: 1, y: 1 }]);
    press('A');
    expect(input.drain()).toEqual([{ type: 'player/move', slot: 0, x: 0, y: 1 }]);
    release('S', 'D', 'A');
    expect(input.drain()).toEqual([{ type: 'player/move', slot: 0, x: 0, y: 0 }]);
  });

  it('collapses a press and release between drains into nothing', () => {
    const { scene, press, release } = fakeScene();
    const input = createKeyboardInput(scene, 0);
    press('UP');
    release('UP');
    expect(input.drain()).toEqual([]);
  });

  it('produces no commands when the scene has no keyboard plugin', () => {
    const scene = { input: { keyboard: null } } as unknown as Phaser.Scene;
    const input = createKeyboardInput(scene, 0);
    expect(input.drain()).toEqual([]);
  });
});
