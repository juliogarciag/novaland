import { generatedWorldMap, readMapTiles, worldMap } from '@novaland/sim';
import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';
import { __testing__, MapCamera } from './camera';
import { PIXELS_PER_METRE } from './units';

describe('MapCamera.view', () => {
  it('is what Phaser will render before the camera was ever pointed anywhere: the scroll clamped to the map, not the raw (0, 0)', () => {
    // A 1920 px canvas at zoom 6 shows 320 px of a 640 px map; Phaser will clamp the untouched scroll of 0 when it renders.
    const camera = fakeCamera({ width: 1920, height: 1080, zoom: 6 });
    const smallMap = generatedWorldMap({ columns: 40, rows: 30 });
    const mapCamera = new MapCamera(camera, smallMap);
    const view = mapCamera.view();
    const { bounds } = readMapTiles(smallMap);
    expect(view.width).toBe(320);
    expect(view.x).toBeGreaterThanOrEqual(bounds.column * PIXELS_PER_METRE);
    expect(view.x + view.width).toBeLessThanOrEqual((bounds.column + bounds.width) * PIXELS_PER_METRE);
    expect(view.y).toBeGreaterThanOrEqual(bounds.row * PIXELS_PER_METRE);
    expect(view.y + view.height).toBeLessThanOrEqual((bounds.row + bounds.height) * PIXELS_PER_METRE);
    // The raw scroll would have put the view outside the map.
    expect(camera.scrollX + (camera.width - camera.width / camera.zoom) / 2 + view.width).toBeGreaterThan((bounds.column + bounds.width) * PIXELS_PER_METRE);
  });

  it('is the rectangle around the point just looked at', () => {
    const camera = fakeCamera({ width: 960, height: 720, zoom: 3 });
    const mapCamera = new MapCamera(camera, worldMap);
    mapCamera.lookAt(320, 240);
    expect(mapCamera.view()).toEqual({ x: 160, y: 120, width: 320, height: 240 });
  });
});

describe('MapCamera zoom', () => {
  it('opens at the normal view and steps out to the whole map and back, stopping at both ends', () => {
    const camera = fakeCamera({ width: 1920, height: 1080, zoom: 1 });
    const mapCamera = new MapCamera(camera, LARGE_MAP);
    mapCamera.fitZoomTo({ width: 1920, height: 1080 });
    const { levels } = mapCamera.zoomReport();
    expect(camera.zoom).toBe(6);
    expect(levels[0]).toBe(6);
    mapCamera.zoomOut(1);
    expect(camera.zoom).toBe(levels[1]);
    mapCamera.zoomOut(100);
    expect(mapCamera.zoomReport().stepsOut).toBe(levels.length - 1);
    // The whole map is on screen: 400x300 tiles in 1920x1080 is limited by the height.
    expect(camera.zoom).toBeCloseTo(1080 / (300 * PIXELS_PER_METRE), 9);
    expect(mapCamera.tilesInView()).toEqual({ across: 400, down: 300 });
    mapCamera.zoomOut(-100);
    expect(camera.zoom).toBe(6);
    expect(mapCamera.zoomReport().stepsOut).toBe(0);
  });

  it('ignores a number of steps that makes no sense', () => {
    const camera = fakeCamera({ width: 1920, height: 1080, zoom: 1 });
    const mapCamera = new MapCamera(camera, LARGE_MAP);
    mapCamera.fitZoomTo({ width: 1920, height: 1080 });
    mapCamera.zoomOut(2);
    for (const steps of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) mapCamera.zoomOut(steps);
    expect(mapCamera.zoomReport().stepsOut).toBe(2);
  });

  it('stays as many steps out when the canvas changes size', () => {
    const camera = fakeCamera({ width: 1920, height: 1080, zoom: 1 });
    const mapCamera = new MapCamera(camera, LARGE_MAP);
    mapCamera.fitZoomTo({ width: 1920, height: 1080 });
    mapCamera.zoomOut(2);
    mapCamera.fitZoomTo({ width: 2880, height: 1800 });
    expect(mapCamera.zoomReport().stepsOut).toBe(2);
    expect(camera.zoom).toBe(mapCamera.zoomReport().levels[2]);
  });

  it('puts the map in the middle of a view that shows more than the map', () => {
    const camera = fakeCamera({ width: 1920, height: 1080, zoom: 1 });
    const mapCamera = new MapCamera(camera, LARGE_MAP);
    mapCamera.fitZoomTo({ width: 1920, height: 1080 });
    mapCamera.zoomOut(100);
    // Wherever the player stands, the map's corner included.
    mapCamera.lookAt(0, 0);
    const view = mapCamera.view();
    const mapWidth = 400 * PIXELS_PER_METRE;
    expect(view.width).toBeGreaterThan(mapWidth);
    expect(view.x + view.width / 2).toBeCloseTo(mapWidth / 2, 0);
    expect(view.y).toBeCloseTo(0, 0);
  });
});

describe('boundsAlongAxis', () => {
  it('is the map while the map is longer than the view', () => {
    expect(boundsAlongAxis({ mapStart: -64, mapLength: 1000, viewLength: 400 })).toEqual({ start: -64, length: 1000 });
    expect(boundsAlongAxis({ mapStart: -64, mapLength: 1000, viewLength: 1000 })).toEqual({ start: -64, length: 1000 });
  });

  it('is the view with the map in its middle when the view is the longer one', () => {
    expect(boundsAlongAxis({ mapStart: 100, mapLength: 1000, viewLength: 1600 })).toEqual({ start: -200, length: 1600 });
  });

  it('is the map for a view that makes no sense', () => {
    expect(boundsAlongAxis({ mapStart: 0, mapLength: 1000, viewLength: Number.NaN })).toEqual({ start: 0, length: 1000 });
  });
});

describe('snapViewToDevicePixels', () => {
  it('puts the top-left corner of the view on a whole device pixel', () => {
    // Phaser zooms around the canvas centre, so this is where the view's top-left corner sits.
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

  it('keeps the clamped edges of a map on the grid, so the map edge never drifts', () => {
    // A 1024 px wide map seen through a 960 px canvas at zoom 3: Phaser clamps scroll to [-512 + 320, 512 - 640].
    const size = 960;
    const zoom = 3;
    const minScroll = -512 + (size / zoom - size) / 2;
    const maxScroll = minScroll + 1024 - size / zoom;
    expect(snapViewToDevicePixels(minScroll, size, zoom)).toBeCloseTo(minScroll, 9);
    expect(snapViewToDevicePixels(maxScroll, size, zoom)).toBeCloseTo(maxScroll, 9);
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { snapViewToDevicePixels, boundsAlongAxis } = __testing__;

/** 400x300 tiles from the origin: far too large for a window at the normal zoom. */
const LARGE_MAP = generatedWorldMap({ columns: 400, rows: 300 });

/** The parts of a Phaser camera `MapCamera` uses, clamping the way Phaser's `clampX` and `clampY` do. */
function fakeCamera({ width, height, zoom: openingZoom }: { width: number; height: number; zoom: number }): Phaser.Cameras.Scene2D.Camera {
  const bounds = { x: 0, y: 0, width: 0, height: 0 };
  const clamp = ({ scroll, size, start, length }: { scroll: number; size: number; start: number; length: number }): number => {
    const displaySize = size / camera.zoom;
    const lowest = start + (displaySize - size) / 2;
    return Math.min(Math.max(scroll, lowest), Math.max(lowest, lowest + length - displaySize));
  };
  const camera = {
    width,
    height,
    zoom: openingZoom,
    setZoom(zoom: number) {
      camera.zoom = zoom;
    },
    scrollX: 0,
    scrollY: 0,
    useBounds: false,
    setBounds(x: number, y: number, boundsWidth: number, boundsHeight: number) {
      Object.assign(bounds, { x, y, width: boundsWidth, height: boundsHeight });
      camera.useBounds = true;
    },
    clampX: (scroll: number) => clamp({ scroll, size: width, start: bounds.x, length: bounds.width }),
    clampY: (scroll: number) => clamp({ scroll, size: height, start: bounds.y, length: bounds.height }),
    centerOn(x: number, y: number) {
      camera.scrollX = camera.clampX(x - width / 2);
      camera.scrollY = camera.clampY(y - height / 2);
    },
    setScroll(x: number, y: number) {
      camera.scrollX = x;
      camera.scrollY = y;
    },
  };
  return camera as unknown as Phaser.Cameras.Scene2D.Camera;
}
