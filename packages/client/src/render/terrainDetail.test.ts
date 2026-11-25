import { describe, expect, it } from 'vitest';
import { NEAREST_ZOOM_DRAWN_AS_ART, terrainDetailAt } from './terrainDetail';
import { PIXELS_PER_METRE } from './units';
import { zoomLevels } from './zoom';

describe('terrainDetailAt', () => {
  it('is the art at every whole-number zoom and at the nearest zoom below 1', () => {
    for (const zoom of [12, 9, 2, 1, NEAREST_ZOOM_DRAWN_AS_ART]) expect(terrainDetailAt(zoom)).toBe('art');
  });

  it('is colours further out than that', () => {
    for (const zoom of [NEAREST_ZOOM_DRAWN_AS_ART - 0.01, 0.25, 0.1758, 1 / PIXELS_PER_METRE]) expect(terrainDetailAt(zoom)).toBe('colors');
  });

  it('never draws the art at a zoom the wheel reaches that is not crisp, on maps and windows of many sizes', () => {
    let artLevels = 0;
    for (const canvasWidth of [960, 1920, 2880, 3840]) {
      for (const mapTiles of [40, 150, 400, 896, 5000]) {
        const levels = zoomLevels({ canvasWidth, canvasHeight: canvasWidth * 0.625, mapWidth: mapTiles * PIXELS_PER_METRE, mapHeight: mapTiles * 0.7 * PIXELS_PER_METRE });
        for (const zoom of levels.filter((level) => terrainDetailAt(level) === 'art')) {
          artLevels += 1;
          expect(Number.isInteger(zoom) || zoom === NEAREST_ZOOM_DRAWN_AS_ART, `zoom ${zoom}`).toBe(true);
        }
      }
    }
    expect(artLevels).toBeGreaterThan(20);
  });
});
