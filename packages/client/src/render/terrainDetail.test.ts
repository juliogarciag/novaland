import { describe, expect, it } from 'vitest';
import { NEAREST_ZOOM_DRAWN_AS_ART, terrainDetailAt } from './terrainDetail';
import { zoomLevels } from './zoom';

describe('terrainDetailAt', () => {
  it('is the art at every whole-number zoom and at the nearest zoom below 1', () => {
    for (const zoom of [12, 9, 2, 1, NEAREST_ZOOM_DRAWN_AS_ART]) expect(terrainDetailAt(zoom)).toBe('art');
  });

  it('is colours further out than that', () => {
    for (const zoom of [0.49, 0.25, 0.1758, 1 / 16]) expect(terrainDetailAt(zoom)).toBe('colours');
  });

  it('is colours wherever the zoom is any fraction: only the last level of the wheel is, and it lies below the art', () => {
    for (const canvasWidth of [960, 1920, 2880, 3840]) {
      const levels = zoomLevels({ canvasWidth, canvasHeight: canvasWidth * 0.625, mapWidth: 896 * 16, mapHeight: 640 * 16 });
      for (const zoom of levels) {
        if (terrainDetailAt(zoom) === 'art') expect(Number.isInteger(zoom) || zoom === 0.5).toBe(true);
      }
    }
  });
});
