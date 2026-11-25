import { describe, expect, it } from 'vitest';
import { __testing__, wheelStepOf } from './wheel';

describe('wheelStepOf', () => {
  it('steps out when the wheel goes down and in when it goes up, however far the browser says it travelled', () => {
    for (const travel of [0.5, 4, 100, 5000]) {
      expect(wheelStepOf({ deltaY: travel, timeMs: 1000, lastStep: undefined })).toEqual({ stepsOut: 1, timeMs: 1000 });
      expect(wheelStepOf({ deltaY: -travel, timeMs: 1000, lastStep: undefined })).toEqual({ stepsOut: -1, timeMs: 1000 });
    }
  });

  it('makes one step of the many events of a swipe, then another once the interval has passed', () => {
    let lastStep = wheelStepOf({ deltaY: 3, timeMs: 0, lastStep: undefined });
    let steps = 1;
    for (let timeMs = 10; timeMs < WHEEL_STEP_INTERVAL_MS * 3; timeMs += 10) {
      const step = wheelStepOf({ deltaY: 3, timeMs, lastStep });
      if (!step) continue;
      expect(step.timeMs - lastStep!.timeMs).toBeGreaterThanOrEqual(WHEEL_STEP_INTERVAL_MS);
      lastStep = step;
      steps += 1;
    }
    expect(steps).toBe(3);
  });

  it('steps at once when the wheel turns the other way', () => {
    const out = wheelStepOf({ deltaY: 100, timeMs: 0, lastStep: undefined });
    expect(wheelStepOf({ deltaY: -100, timeMs: 1, lastStep: out })).toEqual({ stepsOut: -1, timeMs: 1 });
  });

  it('makes no step of an event that did not go up or down, or that makes no sense', () => {
    for (const deltaY of [0, Number.NaN, Number.POSITIVE_INFINITY]) expect(wheelStepOf({ deltaY, timeMs: 0, lastStep: undefined })).toBeUndefined();
    expect(wheelStepOf({ deltaY: 100, timeMs: Number.NaN, lastStep: undefined })).toBeUndefined();
  });
});

// ---- Helpers ----

const { WHEEL_STEP_INTERVAL_MS } = __testing__;
