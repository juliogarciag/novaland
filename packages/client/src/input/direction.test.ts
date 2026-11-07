import { describe, expect, it } from 'vitest';
import { directionFromKeys, sameDirection } from './direction';

const none = { up: false, down: false, left: false, right: false };

describe('directionFromKeys', () => {
  it('is zero with nothing pressed', () => {
    expect(directionFromKeys(none)).toEqual({ x: 0, y: 0 });
  });

  it('maps single keys to unit axes, y pointing down', () => {
    expect(directionFromKeys({ ...none, right: true })).toEqual({ x: 1, y: 0 });
    expect(directionFromKeys({ ...none, left: true })).toEqual({ x: -1, y: 0 });
    expect(directionFromKeys({ ...none, up: true })).toEqual({ x: 0, y: -1 });
    expect(directionFromKeys({ ...none, down: true })).toEqual({ x: 0, y: 1 });
  });

  it('cancels opposite keys', () => {
    expect(directionFromKeys({ ...none, left: true, right: true })).toEqual({ x: 0, y: 0 });
    expect(directionFromKeys({ ...none, up: true, down: true })).toEqual({ x: 0, y: 0 });
  });

  it('reports diagonals raw; the sim normalises them', () => {
    expect(directionFromKeys({ ...none, right: true, down: true })).toEqual({ x: 1, y: 1 });
  });

  it('compares directions by value', () => {
    expect(sameDirection({ x: 1, y: 0 }, { x: 1, y: 0 })).toBe(true);
    expect(sameDirection({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(false);
  });
});
