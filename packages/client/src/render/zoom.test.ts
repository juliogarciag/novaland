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

  it('shows the metres the same rule showed with art at 16 pixels per metre wherever that zoom was even, and at most half as much again where it was odd', () => {
    for (let width = ONE_ZOOM_WIDTH; width < 6000; width += 1) {
      const zoomAtSixteen = Math.floor(width / (16 * MIN_VISIBLE_METRES));
      const extraWorld = (zoomAtSixteen * 16) / (wholeZoomFor(width) * PIXELS_PER_METRE);
      if (zoomAtSixteen % 2 === 0) expect(extraWorld, `${width} px`).toBe(1);
      else expect(extraWorld, `${width} px`).toBe(zoomAtSixteen / (zoomAtSixteen - 1));
      expect(extraWorld, `${width} px`).toBeLessThanOrEqual(1.5);
    }
  });

  it('shows exactly the metres it did at 16 pixels per metre on common full-screen widths', () => {
    for (const width of [1280, 1440, 1920, 2560, 3456, 3840]) {
      expect(width / (PIXELS_PER_METRE * wholeZoomFor(width)), `${width} px`).toBe(width / (16 * Math.floor(width / (16 * MIN_VISIBLE_METRES))));
    }
  });

  it('draws a canvas narrower than the minimum at zoom 1, showing fewer metres than the minimum: half what 16 pixels per metre showed', () => {
    for (const width of [320, 480, ONE_ZOOM_WIDTH - 1]) {
      expect(wholeZoomFor(width)).toBe(1);
      expect(width / PIXELS_PER_METRE).toBeLessThan(MIN_VISIBLE_METRES);
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
