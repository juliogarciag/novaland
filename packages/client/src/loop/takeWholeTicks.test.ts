import { describe, expect, it } from 'vitest';
import { takeWholeTicks } from './takeWholeTicks';

describe('takeWholeTicks', () => {
  it('runs zero ticks and keeps the time when a frame is shorter than a tick', () => {
    const r = takeWholeTicks({ leftover: 0, deltaSeconds: 0.01, dt: DT, maxFrameSeconds: MAX });
    expect(r.ticks).toBe(0);
    expect(r.leftover).toBeCloseTo(0.01, 9);
  });

  it('carries the remainder across frames so no time is lost', () => {
    let acc = 0;
    let total = 0;
    for (let i = 0; i < 100; i += 1) {
      const r = takeWholeTicks({ leftover: acc, deltaSeconds: 0.0069, dt: DT, maxFrameSeconds: MAX }); // 144 Hz frames
      acc = r.leftover;
      total += r.ticks;
    }
    expect(total).toBe(Math.floor((100 * 0.0069) / DT));
    expect(acc).toBeLessThan(DT);
  });

  it('runs several ticks for a long frame', () => {
    expect(takeWholeTicks({ leftover: 0, deltaSeconds: 0.05, dt: DT, maxFrameSeconds: MAX }).ticks).toBe(3);
  });

  it('clamps huge frames (tab switch) instead of spiralling', () => {
    expect(takeWholeTicks({ leftover: 0, deltaSeconds: 10, dt: DT, maxFrameSeconds: MAX }).ticks).toBe(Math.round(MAX / DT));
  });

  it('ignores negative deltas', () => {
    expect(takeWholeTicks({ leftover: 0.005, deltaSeconds: -1, dt: DT, maxFrameSeconds: MAX })).toEqual({ ticks: 0, leftover: 0.005 });
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const DT = 1 / 60;
const MAX = 0.25;
