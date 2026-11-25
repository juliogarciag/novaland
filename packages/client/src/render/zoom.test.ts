import { describe, expect, it } from 'vitest';
import { PIXELS_PER_METRE } from './units';
import { __testing__, MIN_VISIBLE_METRES, wholeZoomFor, zoomLevels } from './zoom';

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

describe('zoomLevels', () => {
  it('starts at the normal view and ends with the whole map on screen', () => {
    const levels = zoomLevels(RETINA_WINDOW_ON_REGION);
    expect(levels[0]).toBe(wholeZoomFor(RETINA_WINDOW_ON_REGION.canvasWidth));
    const furthest = levels.at(-1)!;
    expect(RETINA_WINDOW_ON_REGION.mapWidth * furthest).toBeLessThanOrEqual(RETINA_WINDOW_ON_REGION.canvasWidth);
    expect(RETINA_WINDOW_ON_REGION.mapHeight * furthest).toBeCloseTo(RETINA_WINDOW_ON_REGION.canvasHeight, 9);
  });

  it('steps through whole numbers down to 1, then halves, and only the last level is any fraction', () => {
    expect(zoomLevels(RETINA_WINDOW_ON_REGION)).toEqual([9, 4, 2, 1, 0.5, 0.25, 1800 / REGION_HEIGHT]);
  });

  it('shows more with every step', () => {
    for (const canvasWidth of [640, 1280, 1920, 2880, 3840, 5120]) {
      const levels = zoomLevels({ ...RETINA_WINDOW_ON_REGION, canvasWidth, canvasHeight: canvasWidth * 0.6 });
      for (let index = 1; index < levels.length; index += 1) expect(levels[index]).toBeLessThan(levels[index - 1]!);
    }
  });

  it('leaves out a halving that would look the same as the whole map', () => {
    // The whole map fits at just under 1/4: a level of 1/4 would be a wheel step that changes nothing to the eye.
    const levels = zoomLevels({ canvasWidth: 1000, canvasHeight: 1000, mapWidth: 4100, mapHeight: 100 });
    expect(levels).toEqual([3, 1, 0.5, 1000 / 4100]);
  });

  it('never draws a tile smaller than a device pixel, however large the map', () => {
    const levels = zoomLevels({ canvasWidth: 1920, canvasHeight: 1080, mapWidth: 16384 * 2 * PIXELS_PER_METRE, mapHeight: 16384 * 2 * PIXELS_PER_METRE });
    expect(levels.at(-1)).toBe(FURTHEST_ZOOM);
    expect(levels.length).toBeLessThan(12);
  });

  it('is the normal view alone for a map that already fits in it', () => {
    expect(zoomLevels({ canvasWidth: 1920, canvasHeight: 1080, mapWidth: 20 * PIXELS_PER_METRE, mapHeight: 10 * PIXELS_PER_METRE })).toEqual([6]);
  });

  it('ends on a crisp zoom for a map small enough to fit while its art is still drawn', () => {
    // 40x30 tiles fit a 1920x1080 canvas at 2.25: the last level is 2, and the map has room to spare.
    expect(zoomLevels({ canvasWidth: 1920, canvasHeight: 1080, mapWidth: 40 * PIXELS_PER_METRE, mapHeight: 30 * PIXELS_PER_METRE })).toEqual([6, 3, 2]);
    // 150 tiles across fit at 0.8: the last level is 1/2.
    expect(zoomLevels({ canvasWidth: 1920, canvasHeight: 1080, mapWidth: 150 * PIXELS_PER_METRE, mapHeight: 50 * PIXELS_PER_METRE })).toEqual([6, 3, 1, 0.5]);
  });

  it('is the normal view alone for sizes that make no sense', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(zoomLevels({ ...RETINA_WINDOW_ON_REGION, canvasHeight: bad })).toEqual([9]);
      expect(zoomLevels({ ...RETINA_WINDOW_ON_REGION, mapWidth: bad })).toEqual([9]);
    }
    expect(zoomLevels({ ...RETINA_WINDOW_ON_REGION, canvasWidth: Number.NaN })).toEqual([1]);
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { FURTHEST_ZOOM } = __testing__;

/** Canvas width at which exactly the minimum metres are visible at zoom 1. */
const ONE_ZOOM_WIDTH = PIXELS_PER_METRE * MIN_VISIBLE_METRES;

/** The Alps region of #70 is 896x640 tiles. */
const REGION_HEIGHT = 640 * PIXELS_PER_METRE;
/** A 1440x900 window at a pixel ratio of 2 on that region. */
const RETINA_WINDOW_ON_REGION = { canvasWidth: 2880, canvasHeight: 1800, mapWidth: 896 * PIXELS_PER_METRE, mapHeight: REGION_HEIGHT };
