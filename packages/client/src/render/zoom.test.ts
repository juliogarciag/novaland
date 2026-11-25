import { describe, expect, it } from 'vitest';
import { PIXELS_PER_METRE } from './units';
import { MIN_VISIBLE_METRES, wholeZoomFor } from './zoom';

describe('wholeZoomFor', () => {
  it('is the largest whole zoom that still shows the minimum metres', () => {
    expect(wholeZoomFor(ONE_ZOOM_WIDTH * 3)).toBe(3);
    expect(wholeZoomFor(ONE_ZOOM_WIDTH * 3 - 1)).toBe(2);
    expect(wholeZoomFor(ONE_ZOOM_WIDTH * 9)).toBe(9);
  });

  it('is always a whole number that shows at least the minimum metres', () => {
    for (let width = 1; width < 5000; width += 7) {
      const zoom = wholeZoomFor(width);
      expect(Number.isInteger(zoom)).toBe(true);
      if (zoom > 1) expect(width / (PIXELS_PER_METRE * zoom)).toBeGreaterThanOrEqual(MIN_VISIBLE_METRES);
    }
  });

  it('never goes below 1, even for a window too narrow for the minimum metres', () => {
    expect(wholeZoomFor(ONE_ZOOM_WIDTH - 1)).toBe(1);
    expect(wholeZoomFor(50)).toBe(1);
  });

  it('is 1 for a width that makes no sense', () => {
    expect(wholeZoomFor(0)).toBe(1);
    expect(wholeZoomFor(-100)).toBe(1);
    expect(wholeZoomFor(Number.NaN)).toBe(1);
    expect(wholeZoomFor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

/** Canvas width at which exactly the minimum metres are visible at zoom 1. */
const ONE_ZOOM_WIDTH = PIXELS_PER_METRE * MIN_VISIBLE_METRES;
