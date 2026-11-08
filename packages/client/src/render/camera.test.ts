import { describe, expect, it } from 'vitest';
import { __testing__ } from './camera';

const { snapViewToDevicePixels } = __testing__;

describe('snapViewToDevicePixels', () => {
  it('puts the top-left corner of the view on a whole device pixel', () => {
    for (const [scroll, size, zoom] of [
      [10.37, 960, 3],
      [-512.49, 1280, 4],
      [0.5, 801, 2],
      [123.456, 2880, 9],
    ]) {
      const snapped = snapViewToDevicePixels(scroll, size, zoom);
      const topLeft = snapped + (size / 2) * (1 - 1 / zoom);
      expect(topLeft * zoom).toBeCloseTo(Math.round(topLeft * zoom), 6);
    }
  });

  it('moves the scroll by less than one device pixel', () => {
    for (const [scroll, size, zoom] of [
      [10.37, 960, 3],
      [-512.49, 1280, 4],
      [0.5, 801, 2],
    ]) {
      expect(Math.abs(snapViewToDevicePixels(scroll, size, zoom) - scroll)).toBeLessThanOrEqual(0.5 / zoom + 1e-9);
    }
  });

  it('leaves a scroll alone that is already on the grid', () => {
    expect(snapViewToDevicePixels(-192, 960, 3)).toBeCloseTo(-192, 9);
    expect(snapViewToDevicePixels(0, 1024, 1)).toBeCloseTo(0, 9);
  });

  it('keeps the clamped edges of a level on the grid, so the map edge never drifts', () => {
    // A 1024 px wide level seen through a 960 px canvas at zoom 3: Phaser clamps scroll to [-512 + 320, 512 - 640].
    const size = 960;
    const zoom = 3;
    const minScroll = -512 + (size / zoom - size) / 2;
    const maxScroll = minScroll + 1024 - size / zoom;
    expect(snapViewToDevicePixels(minScroll, size, zoom)).toBeCloseTo(minScroll, 9);
    expect(snapViewToDevicePixels(maxScroll, size, zoom)).toBeCloseTo(maxScroll, 9);
  });
});
