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

  it('shows about as many metres on common desktop screens as the same rule did with art at 16 pixels per metre', () => {
    // Device pixels across: 1280 to 3840 wide monitors and laptop panels, 1x and 2x.
    for (const width of [1280, 1366, 1440, 1536, 1920, 2560, 2880, 3024, 3456, 3840]) {
      const metresNow = width / (PIXELS_PER_METRE * wholeZoomFor(width));
      const metresAtSixteen = width / (16 * Math.max(1, Math.floor(width / (16 * MIN_VISIBLE_METRES))));
      expect(metresNow, `${width} px`).toBeGreaterThanOrEqual(metresAtSixteen);
      expect(metresNow / metresAtSixteen, `${width} px`).toBeLessThanOrEqual(1.15);
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
