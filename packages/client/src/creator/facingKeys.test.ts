import { describe, expect, it } from 'vitest';
import { facingOfKeyPress, type FacingKeyPress } from './facingKeys';

describe('turning the creator preview with the keys that walk', () => {
  it('faces up, down, left and right with W, S, A, D and the arrows', () => {
    expect(['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'].map((code) => facingOfKeyPress(press({ code })))).toEqual([
      'up',
      'up',
      'down',
      'down',
      'left',
      'left',
      'right',
      'right',
    ]);
  });

  it('leaves every other key alone, and the walking keys too when a modifier is held, so browser shortcuts still work', () => {
    for (const code of ['KeyQ', 'Space', 'Enter', 'Tab', 'Escape', 'Digit1']) expect(facingOfKeyPress(press({ code })), code).toBeUndefined();
    expect(facingOfKeyPress(press({ code: 'KeyA', ctrlKey: true }))).toBeUndefined();
    expect(facingOfKeyPress(press({ code: 'KeyD', metaKey: true }))).toBeUndefined();
    expect(facingOfKeyPress(press({ code: 'ArrowLeft', altKey: true }))).toBeUndefined();
  });
});

// ---- Helpers ----

function press(overrides: Partial<FacingKeyPress>): FacingKeyPress {
  return { code: '', altKey: false, ctrlKey: false, metaKey: false, target: null, ...overrides };
}
