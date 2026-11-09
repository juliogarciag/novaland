import { describe, expect, it } from 'vitest';
import { directionFromVector, poseFromHeading } from './pose';

describe('poseFromHeading', () => {
  it('walks in the direction of a non-zero move intent, whatever the facing says', () => {
    expect(poseFromHeading({ moveIntent: { x: 0, y: -1 }, facing: { x: 1, y: 0 } })).toEqual({ direction: 'up', walking: true });
    expect(poseFromHeading({ moveIntent: { x: -0.2, y: 0 }, facing: { x: 0, y: 1 } })).toEqual({ direction: 'left', walking: true });
  });

  it('stands facing the last direction when the move intent is zero', () => {
    expect(poseFromHeading({ moveIntent: { x: 0, y: 0 }, facing: { x: 1, y: 0 } })).toEqual({ direction: 'right', walking: false });
    expect(poseFromHeading({ moveIntent: { x: 0, y: 0 }, facing: { x: 0, y: 1 } })).toEqual({ direction: 'down', walking: false });
  });
});

describe('directionFromVector', () => {
  it('picks the dominant axis, horizontal on ties, down for a zero vector', () => {
    expect(directionFromVector(1, 0)).toBe('right');
    expect(directionFromVector(-1, 0)).toBe('left');
    expect(directionFromVector(0, -1)).toBe('up');
    expect(directionFromVector(0, 1)).toBe('down');
    expect(directionFromVector(0.3, -0.9)).toBe('up');
    expect(directionFromVector(-0.9, 0.3)).toBe('left');
    expect(directionFromVector(0.7071, 0.7071)).toBe('right');
    expect(directionFromVector(-0.7071, -0.7071)).toBe('left');
    expect(directionFromVector(0, 0)).toBe('down');
  });
});
