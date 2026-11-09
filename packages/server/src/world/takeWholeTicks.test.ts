import { describe, expect, it } from 'vitest';
import { takeWholeTicks } from './takeWholeTicks';

describe('takeWholeTicks (server copy of the client helper)', () => {
  it('runs zero ticks and keeps the time when a wake-up is shorter than a tick', () => {
    const result = takeWholeTicks({ leftover: 0, deltaSeconds: 0.01, dt: DT, maxFrameSeconds: MAX });
    expect(result.ticks).toBe(0);
    expect(result.leftover).toBeCloseTo(0.01, 9);
  });

  it('carries the remainder across wake-ups so no time is lost', () => {
    let leftover = 0;
    let total = 0;
    for (let i = 0; i < 100; i += 1) {
      const result = takeWholeTicks({ leftover, deltaSeconds: 0.016, dt: DT, maxFrameSeconds: MAX }); // a 16 ms timer
      leftover = result.leftover;
      total += result.ticks;
    }
    expect(total).toBe(Math.floor((100 * 0.016) / DT));
    expect(leftover).toBeLessThan(DT);
  });

  it('runs several ticks after a long wake-up', () => {
    expect(takeWholeTicks({ leftover: 0, deltaSeconds: 0.05, dt: DT, maxFrameSeconds: MAX }).ticks).toBe(3);
  });

  it('caps the catch-up after a stall instead of spiralling', () => {
    expect(takeWholeTicks({ leftover: 0, deltaSeconds: 10, dt: DT, maxFrameSeconds: MAX }).ticks).toBe(Math.round(MAX / DT));
  });

  it('ignores negative deltas', () => {
    expect(takeWholeTicks({ leftover: 0.005, deltaSeconds: -1, dt: DT, maxFrameSeconds: MAX })).toEqual({ ticks: 0, leftover: 0.005 });
  });
});

// ---- Helpers ----

const DT = 1 / 60;
const MAX = 0.25;
